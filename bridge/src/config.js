import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { configPath } from "./paths.js";
import { assertAllowedProviderURL } from "./network-policy.js";

export const defaultCodexModel = "gpt-5.6-luna";

export const builtInCodexModels = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Fast Codex model" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "Balanced Codex model" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Most capable Codex model" },
];

export function defaultConfig() {
  return {
    version: 1,
    selectedModel: `codex:${defaultCodexModel}`,
    providers: [
      {
        id: "codex",
        type: "codex",
        label: "Codex",
        enabled: true,
        models: builtInCodexModels,
      },
      {
        id: "apple-on-device",
        type: "apple-foundation-models",
        mode: "on-device",
        label: "Apple On-Device",
        enabled: true,
        models: [{
          id: "default",
          label: "Apple Intelligence (On-Device)",
          description: "Runs privately on this Mac",
        }],
      },
      {
        id: "apple-private-cloud",
        type: "apple-foundation-models",
        mode: "private-cloud",
        label: "Apple Private Cloud Compute",
        enabled: true,
        models: [{
          id: "default",
          label: "Apple Intelligence (Private Cloud)",
          description: "Requires Apple's PCC entitlement and eligibility",
        }],
      },
      {
        id: "ollama",
        type: "openai-compatible",
        api: "chat-completions",
        label: "Ollama",
        enabled: true,
        baseURL: "http://127.0.0.1:11434/v1",
        discoveryURL: "http://127.0.0.1:11434/api/tags",
        apiKeyEnv: null,
        models: [],
      },
      {
        id: "openai",
        type: "openai-compatible",
        api: "responses",
        label: "OpenAI API",
        enabled: true,
        baseURL: "https://api.openai.com/v1",
        discoveryURL: "https://api.openai.com/v1/models",
        apiKeyEnv: "OPENAI_API_KEY",
        models: [],
      },
    ],
    localMemory: {
      enabled: true,
      importBrowserHistory: true,
      captureChats: true,
      retentionDays: 0,
      maxEntries: 100_000,
    },
    localWeb: {
      enabled: true,
    },
    localConnectors: {
      enabled: true,
    },
    adminToken: randomBytes(24).toString("base64url"),
  };
}

function cleanString(value, field, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateModels(models, providerID) {
  if (!Array.isArray(models)) throw new Error(`${providerID}.models must be an array`);
  return models.map((model) => ({
    id: cleanString(model?.id, `${providerID}.models.id`),
    label: cleanString(model?.label ?? model?.id, `${providerID}.models.label`),
    description: typeof model?.description === "string" ? model.description : "",
  }));
}

function validateProvider(provider, seenIDs) {
  const id = cleanString(provider?.id, "provider.id");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`provider id contains unsupported characters: ${id}`);
  }
  if (seenIDs.has(id)) throw new Error(`duplicate provider id: ${id}`);
  seenIDs.add(id);

  const type = cleanString(provider?.type, `${id}.type`);
  if (!["codex", "apple-foundation-models", "openai-compatible"].includes(type)) {
    throw new Error(`unsupported provider type: ${type}`);
  }

  const output = {
    id,
    type,
    label: cleanString(provider?.label ?? id, `${id}.label`),
    enabled: provider?.enabled !== false,
    models: validateModels(provider?.models ?? [], id),
  };

  if (type === "apple-foundation-models") {
    if (!["on-device", "private-cloud"].includes(provider?.mode)) {
      throw new Error(`${id}.mode must be on-device or private-cloud`);
    }
    output.mode = provider.mode;
  }

  if (type === "openai-compatible") {
    if (!["responses", "chat-completions"].includes(provider?.api)) {
      throw new Error(`${id}.api must be responses or chat-completions`);
    }
    output.api = provider.api;
    output.baseURL = assertAllowedProviderURL(
      cleanString(provider?.baseURL, `${id}.baseURL`),
    ).toString().replace(/\/$/, "");
    output.discoveryURL = provider?.discoveryURL
      ? assertAllowedProviderURL(provider.discoveryURL).toString()
      : null;
    output.apiKeyEnv = cleanString(provider?.apiKeyEnv, `${id}.apiKeyEnv`, {
      optional: true,
    });
    if (output.apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/i.test(output.apiKeyEnv)) {
      throw new Error(`${id}.apiKeyEnv is not a valid environment variable name`);
    }
  }

  return output;
}

export function validateConfig(input, previous = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("configuration must be a JSON object");
  }
  const seenIDs = new Set();
  const providers = (input.providers ?? []).map((provider) =>
    validateProvider(provider, seenIDs));
  if (providers.length === 0) throw new Error("at least one provider is required");

  const selectedModel = cleanString(input.selectedModel, "selectedModel");
  const separator = selectedModel.indexOf(":");
  if (separator <= 0 || !seenIDs.has(selectedModel.slice(0, separator))) {
    throw new Error(`selectedModel references an unknown provider: ${selectedModel}`);
  }

  return {
    version: 1,
    selectedModel,
    providers,
    localMemory: {
      enabled: input.localMemory?.enabled !== false,
      importBrowserHistory: input.localMemory?.importBrowserHistory !== false,
      captureChats: input.localMemory?.captureChats !== false,
      retentionDays: Number.isInteger(input.localMemory?.retentionDays)
        ? Math.max(0, Math.min(3_650, input.localMemory.retentionDays))
        : 0,
      maxEntries: Number.isInteger(input.localMemory?.maxEntries)
        ? Math.max(1_000, Math.min(1_000_000, input.localMemory.maxEntries))
        : 100_000,
    },
    localWeb: {
      enabled: input.localWeb?.enabled !== false,
    },
    localConnectors: {
      enabled: input.localConnectors?.enabled !== false,
    },
    adminToken: typeof previous?.adminToken === "string"
      ? previous.adminToken
      : typeof input.adminToken === "string" && input.adminToken.length >= 24
        ? input.adminToken
        : randomBytes(24).toString("base64url"),
  };
}

async function atomicWriteJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

export class ConfigStore {
  constructor(path = configPath) {
    this.path = path;
    this.value = null;
  }

  async load() {
    if (this.value) return this.value;
    let raw;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      raw = defaultConfig();
    }
    this.value = validateConfig(raw);
    if (process.env.DIA_CUSTOM_CODEX_MODEL) {
      this.value.selectedModel = `codex:${process.env.DIA_CUSTOM_CODEX_MODEL}`;
    }
    await atomicWriteJSON(this.path, this.value);
    return this.value;
  }

  async update(nextValue) {
    const current = await this.load();
    this.value = validateConfig(nextValue, current);
    await atomicWriteJSON(this.path, this.value);
    return this.value;
  }

  async select(modelKey) {
    const current = await this.load();
    const providerID = cleanString(modelKey, "modelKey").split(":", 1)[0];
    if (!current.providers.some((provider) => provider.id === providerID && provider.enabled)) {
      throw new Error(`model provider is unavailable: ${providerID}`);
    }
    this.value = { ...current, selectedModel: modelKey };
    await atomicWriteJSON(this.path, this.value);
    return this.value;
  }

  publicValue() {
    if (!this.value) return null;
    const { adminToken: _adminToken, ...publicConfig } = this.value;
    return publicConfig;
  }
}
