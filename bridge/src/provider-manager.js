import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  normalizeAnthropicTools,
  appendToolResults,
  deferredAnthropicTools,
  isDiaOwnedProductKnowledgeTool,
  reportWorkflowRequiresTool,
  reportWorkflowState,
  removeRepeatedFailedToolCalls,
  withReportWorkflowPolicy,
} from "./chat-shape.js";
import { ConfigStore } from "./config.js";
import { CredentialStore } from "./credentials.js";
import { LocalToolRegistry } from "./local-tools/index.js";
import { MemoryStore } from "./local-tools/memory.js";
import { assertAllowedProviderURL } from "./network-policy.js";
import { modelCatalogPath } from "./paths.js";
import { ToolCoverageStore } from "./tool-coverage.js";
import {
  appleProviderStatus,
  appleSentenceEmbeddings,
  runAppleProvider,
} from "./providers/apple.js";
import { runCodexProvider } from "./providers/codex.js";
import { runOpenAICompatibleProvider } from "./providers/openai-compatible.js";

const catalogLifetimeMilliseconds = 60_000;
const maximumLocalToolRounds = 6;
const maximumReportDecisionRetries = 2;
const historyRefreshMilliseconds = 5 * 60_000;

function nativeReportDecision(state, tools, model) {
  if (!state?.active) return null;
  if (state.stage === "load_skills") {
    const skillTool = tools.find((tool) => tool.name === "Skill" && tool.source === "native");
    if (!skillTool) return null;
    return {
      kind: "tool_use",
      text: "",
      toolCalls: state.missingSkills.map((skill) => ({
        id: `toolu_dia_custom_${randomBytes(12).toString("hex")}`,
        name: skillTool.name,
        input: { skill },
      })),
      model,
    };
  }
  if (state.stage === "upload_report") {
    const uploadTool = tools.find((tool) =>
      tool.source === "native" &&
      (tool.name === "upload_artifact" || tool.name.endsWith("__upload_artifact")));
    if (!uploadTool) return null;
    return {
      kind: "tool_use",
      text: "",
      toolCalls: [{
        id: `toolu_dia_custom_${randomBytes(12).toString("hex")}`,
        name: uploadTool.name,
        input: state.uploadInput,
      }],
      model,
    };
  }
  return null;
}

function splitModelKey(key) {
  const separator = typeof key === "string" ? key.indexOf(":") : -1;
  if (separator < 1 || separator === key.length - 1) {
    throw new Error(`invalid model key: ${key}`);
  }
  return { providerID: key.slice(0, separator), model: key.slice(separator + 1) };
}

async function atomicWriteJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

function modelRecord(provider, model, status = {}) {
  return {
    key: `${provider.id}:${model.id}`,
    providerID: provider.id,
    providerLabel: provider.label,
    providerType: provider.type,
    model: model.id,
    label: model.label || model.id,
    description: model.description || "",
    available: status.available !== false,
    ...(status.reason ? { reason: status.reason } : {}),
  };
}

function discoveryHeaders(provider, apiKey) {
  const headers = { accept: "application/json" };
  if (provider.apiKeyEnv && !apiKey) throw new Error(`${provider.label} needs a credential`);
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function normalizeDiscoveredModels(provider, payload) {
  const candidates = provider.id === "ollama"
    ? payload?.models?.map((item) => item?.name ?? item?.model)
    : payload?.data?.map((item) => item?.id);
  return [...new Set((candidates ?? []).filter((value) => typeof value === "string" && value))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 250)
    .map((id) => ({ id, label: id, description: "Discovered locally" }));
}

export class ProviderManager {
  constructor({
    configStore = new ConfigStore(),
    credentialStore = new CredentialStore(),
    memoryStore = null,
    fetchImplementation = fetch,
    appleStatusImplementation = appleProviderStatus,
    catalogPath = modelCatalogPath,
    toolCoverageStore = new ToolCoverageStore(),
  } = {}) {
    this.configStore = configStore;
    this.credentialStore = credentialStore;
    this.memoryStore = memoryStore ?? new MemoryStore(undefined, undefined, {
      embedder: async (texts) => appleSentenceEmbeddings(texts),
    });
    this.localTools = new LocalToolRegistry(this.memoryStore, configStore);
    this.fetch = fetchImplementation;
    this.appleStatus = appleStatusImplementation;
    this.catalogPath = catalogPath;
    this.toolCoverageStore = toolCoverageStore;
    this.catalogValue = null;
    this.catalogPromise = null;
    this.catalogUpdatedAt = 0;
    this.historyImportPromise = null;
    this.historyRefreshTimer = null;
  }

  async initialize() {
    const config = await this.configStore.load();
    await this.memoryStore.open();
    if (config.localMemory.enabled && config.localMemory.importBrowserHistory) {
      this.historyImportPromise = this.refreshLocalMemory(config)
        .then((count) => {
          if (count > 0) process.stdout.write(`Imported ${count} local browsing history entries\n`);
          return count;
        })
        .catch((error) => {
          process.stderr.write(`Local memory import failed: ${String(error?.message ?? error)}\n`);
          return 0;
        });
    }
    this.historyRefreshTimer = setInterval(() => {
      this.configStore.load().then((current) => this.refreshLocalMemory(current)).catch((error) => {
        process.stderr.write(`Local history refresh failed: ${String(error?.message ?? error)}\n`);
      });
    }, historyRefreshMilliseconds);
    this.historyRefreshTimer.unref();
    await this.refreshCatalog({ force: true });
    return this;
  }

  async refreshLocalMemory(config) {
    if (!config.localMemory.enabled || !config.localMemory.importBrowserHistory) return 0;
    const count = await this.memoryStore.importBrowserHistory();
    await this.memoryStore.prune(config.localMemory);
    return count;
  }

  async discoverOpenAICompatible(provider) {
    const configured = provider.models.map((model) => modelRecord(provider, model));
    if (!provider.discoveryURL) return configured;
    try {
      const url = assertAllowedProviderURL(provider.discoveryURL);
      const apiKey = await this.credentialStore.get(provider);
      const response = await this.fetch(url, {
        headers: discoveryHeaders(provider, apiKey),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const discovered = normalizeDiscoveredModels(provider, await response.json());
      const byKey = new Map(configured.map((record) => [record.key, record]));
      for (const model of discovered) byKey.set(`${provider.id}:${model.id}`, modelRecord(provider, model));
      return [...byKey.values()];
    } catch (error) {
      const reason = String(error?.message ?? error);
      if (configured.length > 0) {
        return configured.map((record) => ({ ...record, available: false, reason }));
      }
      return [];
    }
  }

  async discoverProvider(provider, appleStatus) {
    if (!provider.enabled) return [];
    if (provider.type === "codex") {
      return provider.models.map((model) => modelRecord(provider, model));
    }
    if (provider.type === "apple-foundation-models") {
      const status = provider.mode === "on-device"
        ? appleStatus?.onDevice
        : appleStatus?.privateCloud;
      return provider.models.map((model) => modelRecord(provider, model, status ?? {
        available: false,
        reason: "Apple model status is unavailable",
      }));
    }
    return this.discoverOpenAICompatible(provider);
  }

  async refreshCatalog({ force = false } = {}) {
    if (!force && this.catalogValue &&
        Date.now() - this.catalogUpdatedAt < catalogLifetimeMilliseconds) {
      return this.catalogValue;
    }
    if (this.catalogPromise) return this.catalogPromise;
    this.catalogPromise = (async () => {
      const config = await this.configStore.load();
      const credentialStatus = await this.credentialStore.status(config.providers);
      const hasApple = config.providers.some((provider) =>
        provider.enabled && provider.type === "apple-foundation-models");
      const appleStatus = hasApple ? await this.appleStatus() : null;
      const groups = await Promise.all(config.providers.map((provider) =>
        this.discoverProvider(provider, appleStatus)));
      const models = groups.flat();
      const catalog = {
        version: 1,
        generatedAt: new Date().toISOString(),
        selectedModel: config.selectedModel,
        models,
        providers: config.providers.map((provider) => ({
          id: provider.id,
          label: provider.label,
          type: provider.type,
          enabled: provider.enabled,
          modelCount: models.filter((model) => model.providerID === provider.id).length,
          credentialConfigured: credentialStatus[provider.id]?.configured ?? false,
          credentialSource: credentialStatus[provider.id]?.source ?? null,
        })),
        // The file is mode 0600 and consumed by the injected native picker.
        // Mutating HTTP routes still require this unguessable local token.
        selectionToken: config.adminToken,
      };
      await atomicWriteJSON(this.catalogPath, catalog);
      this.catalogValue = catalog;
      this.catalogUpdatedAt = Date.now();
      return catalog;
    })();
    try {
      return await this.catalogPromise;
    } finally {
      this.catalogPromise = null;
    }
  }

  async publicCatalog({ force = false } = {}) {
    const { selectionToken: _selectionToken, ...catalog } = await this.refreshCatalog({ force });
    return catalog;
  }

  async select(modelKey) {
    const catalog = await this.refreshCatalog({ force: true });
    const selected = catalog.models.find((model) => model.key === modelKey);
    if (!selected) throw new Error(`unknown model: ${modelKey}`);
    if (!selected.available) throw new Error(selected.reason || `${selected.label} is unavailable`);
    await this.configStore.select(modelKey);
    return this.refreshCatalog({ force: true });
  }

  async updateConfig(value) {
    await this.configStore.update(value);
    return this.refreshCatalog({ force: true });
  }

  async selectedProvider() {
    const config = await this.configStore.load();
    const { providerID, model } = splitModelKey(config.selectedModel);
    const provider = config.providers.find((candidate) =>
      candidate.id === providerID && candidate.enabled);
    if (!provider) throw new Error(`selected provider is unavailable: ${providerID}`);
    return { config, provider, model, key: config.selectedModel };
  }

  async runProvider(provider, options) {
    if (provider.type === "codex") return runCodexProvider(options);
    if (provider.type === "apple-foundation-models") {
      return runAppleProvider({ ...options, provider });
    }
    return runOpenAICompatibleProvider({ ...options, provider });
  }

  async run(payload, { onReasoning } = {}) {
    const { config, provider, model, key } = await this.selectedProvider();
    const observedNativeTools = normalizeAnthropicTools(payload, { includeBlocked: true });
    const observedForCoverage = new Map(
      deferredAnthropicTools(payload).map((tool) => [tool.name, tool]),
    );
    for (const tool of observedNativeTools) observedForCoverage.set(tool.name, tool);
    const nativeTools = observedNativeTools.filter((tool) =>
      !isDiaOwnedProductKnowledgeTool(tool.name));
    const tools = await this.localTools.definitions(nativeTools);
    await this.toolCoverageStore.record([...observedForCoverage.values()], tools).catch((error) => {
      process.stderr.write(`Tool coverage write failed: ${String(error?.message ?? error)}\n`);
    });
    const apiKey = provider.type === "openai-compatible"
      ? await this.credentialStore.get(provider)
      : null;
    let currentPayload = payload;
    let result;
    let localToolRounds = 0;
    let reportDecisionRetries = 0;

    while (true) {
      const reportState = reportWorkflowState(currentPayload);
      const nativeReportResult = nativeReportDecision(reportState, tools, key);
      if (nativeReportResult) {
        result = nativeReportResult;
        if (onReasoning) {
          await onReasoning(reportState.stage === "load_skills"
            ? "Loading Dia's native report design tools..."
            : "Adding the finished report to Dia's Reports library...");
        }
        break;
      }
      const providerPayload = reportWorkflowRequiresTool(currentPayload, tools)
        ? withReportWorkflowPolicy(currentPayload, reportState, reportDecisionRetries)
        : currentPayload;
      result = await this.runProvider(provider, {
        payload: providerPayload,
        tools,
        model,
        apiKey,
        onReasoning,
      });
      result.model = key;
      if (result.kind === "tool_use") {
        const { allowed, blocked } = removeRepeatedFailedToolCalls(
          currentPayload,
          result.toolCalls,
        );
        if (blocked.length > 0 && onReasoning) {
          await onReasoning(
            `Stopped ${blocked.map(({ call }) => call.name).join(", ")} after its previous error.`,
          );
        }
        result.toolCalls = allowed;
        if (allowed.length === 0 && blocked.length > 0) {
          const last = blocked.at(-1).failure;
          result = {
            ...result,
            kind: "final",
            toolCalls: [],
            text: `${last.name} failed and was not retried: ${last.result}`,
          };
        }
      }
      const localCalls = result.kind === "tool_use"
        ? result.toolCalls.filter((call) => this.localTools.isLocal(call.name))
        : [];
      if (localCalls.length === 0) {
        if (
          result.kind === "final" &&
          reportWorkflowRequiresTool(currentPayload, tools) &&
          reportDecisionRetries < maximumReportDecisionRetries
        ) {
          reportDecisionRetries += 1;
          if (onReasoning) {
            await onReasoning("Continuing the native report workflow before answering...");
          }
          continue;
        }
        break;
      }
      if (localToolRounds === maximumLocalToolRounds) {
        throw new Error("local tool round limit reached");
      }
      localToolRounds += 1;
      reportDecisionRetries = 0;
      if (onReasoning) await onReasoning(`Running ${localCalls.map((call) => call.name).join(", ")} locally...`);
      const localResults = await Promise.all(localCalls.map(async (call) => {
        try {
          return { call, result: await this.localTools.execute(call) };
        } catch (error) {
          return { call, result: { error: String(error?.message ?? error) } };
        }
      }));
      currentPayload = appendToolResults(currentPayload, localCalls, localResults);
    }

    if (config.localMemory.enabled && config.localMemory.captureChats && result?.kind === "final") {
      await this.memoryStore.recordConversation(payload, result).catch((error) => {
        process.stderr.write(`Local chat memory write failed: ${String(error?.message ?? error)}\n`);
      });
    }
    return { result, nativeToolCount: nativeTools.length, totalToolCount: tools.length };
  }
}

export { splitModelKey };
