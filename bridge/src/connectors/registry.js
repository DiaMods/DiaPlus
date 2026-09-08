import { createHash, randomBytes } from "node:crypto";
import { access, chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { cleanConnectorID, cleanProfileID } from "../apps-state.js";
import { contentAsText, toolResultFailed } from "../chat-shape.js";
import { assertAllowedConnectorURL } from "../network-policy.js";
import { connectorManifestDirectory } from "../paths.js";
import { MCPHTTPClient } from "./mcp-http.js";
import { MCPStdioClient } from "./mcp-stdio.js";
import { MCPSSEClient } from "./mcp-sse.js";
import { validateLocalProcess, processEnvironment } from "./local-process.js";
import { validateCLITools, executeCLI } from "./cli-adapter.js";
import { discoverOAuth } from "./oauth-discovery.js";
import { checkSpark, runSpark, sparkArguments, sparkTools, sparkToolsForVersion, validateSparkCommand } from "./spark-cli.js";

const nativeSessionCatalog = [
  ["gmail", "Gmail", ["search_email", "read_email"]],
  ["google-calendar", "Google Calendar", ["read_calendar"]],
  ["google-drive", "Google Drive", ["search_drive", "fetch_drive"]],
  ["github", "GitHub", ["search_github"]],
  ["slack", "Slack", ["search_slack"]],
  ["notion", "Notion", ["search_notion"]],
  ["linkedin", "LinkedIn", ["search_linkedin"]],
].map(([id, displayName, capabilities]) => ({
  id,
  displayName,
  icon: id,
  execution: "native-session",
  authentication: "browser-session",
  capabilities,
  allowedDomains: [],
  branded: true,
}));

export class ConnectorAdapter {
  constructor(manifest) { this.manifest = Object.freeze({ ...manifest }); }
  get id() { return this.manifest.id; }
  get capabilities() { return this.manifest.capabilities; }
  async sync(_cursor) { return { records: [], cursor: null, supported: false }; }
}

export class NativeSessionAdapter extends ConnectorAdapter {
  constructor(manifest) {
    super({ ...manifest, execution: "native-session", authentication: "browser-session" });
  }
}

export class BridgeConnectorAdapter extends ConnectorAdapter {
  constructor(manifest) { super({ ...manifest, execution: "bridge" }); }
}

function validateManifest(value, path = "connector manifest") {
  const id = cleanConnectorID(value?.id);
  if (nativeSessionCatalog.some((manifest) => manifest.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`${path}: native connector IDs are reserved`);
  }
  const execution = value?.execution ?? "bridge";
  if (execution !== "bridge") throw new Error(`${path}: custom connectors must use bridge execution`);
  const transport = value?.transport ?? "streamable-http";
  if (!["streamable-http", "http-sse", "stdio", "cli", "spark-cli"].includes(transport)) throw new Error(`${path}: unsupported connector transport`);
  const authentication = value?.authentication ?? "none";
  if (transport === "spark-cli") {
    if (authentication !== "none") throw new Error("Spark uses the signed-in Spark Desktop session");
    return {
      id, displayName: String(value?.displayName || "Spark Mail").trim().slice(0, 120),
      execution, transport, authentication, command: validateSparkCommand(value?.command),
      icon: "mail", branded: false, capabilities: sparkTools.map((tool) => tool.name), allowedDomains: [],
    };
  }
  const sync = value.sync === undefined ? {} : { sync: validateSync(value.sync) };
  if (["stdio", "cli"].includes(transport)) {
    if (authentication !== "none") throw new Error("Local connectors use environment credentials, not HTTP authentication");
    const tools = transport === "cli" ? validateCLITools(value.tools) : undefined;
    return { id, displayName: String(value.displayName || id).trim().slice(0, 120),
      execution, transport, authentication, ...validateLocalProcess(value), ...sync,
      ...(tools ? { tools } : {}), icon: "terminal", branded: false,
      capabilities: tools?.map((tool) => tool.name) ?? [], allowedDomains: [] };
  }
  if (!["none", "bearer", "oauth"].includes(authentication)) {
    throw new Error(`${path}: authentication must be none, bearer or oauth`);
  }
  if (!Array.isArray(value?.allowedDomains) || value.allowedDomains.length === 0) {
    throw new Error(`${path}: allowedDomains must list every permitted connector host`);
  }
  const endpoint = assertAllowedConnectorURL(value?.endpoint, value.allowedDomains).toString();
  const manifest = {
    id,
    displayName: typeof value?.displayName === "string" && value.displayName.trim()
      ? value.displayName.trim().slice(0, 120)
      : id,
    icon: typeof value?.icon === "string" ? value.icon.slice(0, 500) : "external-tool",
    execution,
    transport,
    authentication,
    capabilities: Array.isArray(value?.capabilities)
      ? value.capabilities.filter((item) => typeof item === "string").slice(0, 100)
      : [],
    allowedDomains: Array.isArray(value?.allowedDomains) ? value.allowedDomains : [],
    endpoint,
    ...sync,
    branded: false,
  };
  if (authentication === "oauth") {
    const oauth = value.oauth ?? {};
    manifest.oauth = {
      authorizationURL: oauth.authorizationURL ? assertAllowedConnectorURL(oauth.authorizationURL, manifest.allowedDomains).toString() : null,
      tokenURL: oauth.tokenURL ? assertAllowedConnectorURL(oauth.tokenURL, manifest.allowedDomains).toString() : null,
      revocationURL: oauth.revocationURL ? assertAllowedConnectorURL(oauth.revocationURL, manifest.allowedDomains).toString() : null,
      ...(oauth.issuer ? { issuer: assertAllowedConnectorURL(oauth.issuer, manifest.allowedDomains).toString() } : {}),
      clientID: typeof oauth.clientID === "string" ? oauth.clientID.slice(0, 4000) : "",
      scopes: Array.isArray(oauth.scopes) ? oauth.scopes.filter((item) => typeof item === "string").slice(0, 100) : [],
    };
    if (Boolean(manifest.oauth.authorizationURL) !== Boolean(manifest.oauth.tokenURL)) throw new Error("Provide both OAuth endpoints, or leave both blank for discovery");
    if (manifest.oauth.authorizationURL && !manifest.oauth.clientID) throw new Error("Manual OAuth endpoints require a registered client ID");
  }
  return manifest;
}

function validateSync(value) {
  if (!value || typeof value.tool !== "string" || !value.tool || value.tool.length > 200) throw new Error("Connector sync requires a tool name");
  const cursorArgument = value.cursorArgument ?? "cursor";
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(cursorArgument)) throw new Error("Invalid sync cursor argument");
  const args = value.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 16000) throw new Error("Invalid sync arguments");
  return { tool: value.tool, cursorArgument, arguments: structuredClone(args) };
}

function toolName(connectorID, remoteName) {
  const raw = `mcp__custom_${connectorID}__${remoteName}`;
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) return raw;
  const hash = createHash("sha256").update(JSON.stringify([connectorID, remoteName])).digest("hex").slice(0, 12);
  return `${raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 51)}_${hash}`;
}

function credentialRecordID(profileID, connectorID) {
  return `connector.${encodeURIComponent(cleanProfileID(profileID)).replace(/[.!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}.${cleanConnectorID(connectorID)}`;
}

function nativeConnectorForTool(name) {
  if (/^mcp__custom_/i.test(String(name ?? ""))) return null;
  const normalized = String(name ?? "").toLowerCase().replaceAll("-", "_");
  const mappings = [
    ["gmail", ["gmail", "email"]],
    ["google-calendar", ["google_calendar", "calendar"]],
    ["google-drive", ["google_drive", "drive"]],
    ["github", ["github"]],
    ["slack", ["slack"]],
    ["notion", ["notion"]],
    ["linkedin", ["linkedin"]],
  ];
  return mappings.find(([, needles]) => needles.some((needle) => normalized.includes(needle)))?.[0] ?? null;
}

function dynamicNativeConnectorForTool(name, connectorIDs = []) {
  if (/^mcp__custom_/i.test(String(name ?? ""))) return null;
  const known = nativeConnectorForTool(name);
  if (known) return known;
  const normalized = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return connectorIDs.find((id) => {
    const words = String(id).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    return words.length > 0 && words.every((word) => normalized.includes(word));
  }) ?? null;
}

function nativeToolResultError(block) {
  return toolResultFailed(block)
    ? contentAsText(block.content).slice(0, 500) || "Native connector tool failed"
    : null;
}

function authorizationRequired(error) {
  return [401, 403].includes(error?.status) ||
    /authorization is missing or expired|bearer token is required|sign(?:ed)?[ -]in|not authenticated|HTTP (?:401|403)/i.test(String(error?.message ?? error));
}

export class ConnectorRegistry {
  constructor({
    stateStore,
    credentialStore,
    manifestDirectory = connectorManifestDirectory,
    fetchImplementation = fetch,
    callbackBaseURL = "http://127.0.0.1:8765/api/apps/oauth/callback",
    now = () => Date.now(),
    sparkRunner = runSpark,
    sparkChecker = checkSpark,
    onSync = null,
    processRunner,
    spawnImplementation,
  }) {
    this.stateStore = stateStore;
    this.credentialStore = credentialStore;
    this.manifestDirectory = manifestDirectory;
    this.fetch = fetchImplementation;
    this.callbackBaseURL = callbackBaseURL;
    this.now = now;
    this.sparkRunner = sparkRunner;
    this.sparkChecker = sparkChecker;
    this.onSync = onSync;
    this.processRunner = processRunner;
    this.spawnImplementation = spawnImplementation;
    this.syncs = new Map();
    this.manifestPaths = new Map();
    this.clients = new Map();
    this.discovery = new Map();
    this.generations = new Map();
    this.refreshes = new Map();
    this.mutations = Promise.resolve();
    this.manifests = new Map(nativeSessionCatalog.map((item) => [item.id, item]));
    this.adapters = new Map(nativeSessionCatalog.map((item) =>
      [item.id, new NativeSessionAdapter(item)]));
    this.oauthStates = new Map();
    this.toolMap = new Map();
    this.connectionAttempts = new Map();
    this.retryAfter = new Map();
    this.reconnectTimer = null;
    this.closed = false;
  }

  async initialize() {
    if (this.initialized) return this;
    try {
      for (const file of (await readdir(this.manifestDirectory)).sort()) {
        if (!file.endsWith(".json")) continue;
        try {
          const path = resolve(this.manifestDirectory, file);
          const manifest = validateManifest(JSON.parse(await readFile(path, "utf8")), path);
          if (this.manifests.has(manifest.id)) throw new Error("duplicate connector ID");
          this.manifestPaths.set(manifest.id, path);
          this.manifests.set(manifest.id, manifest);
          this.adapters.set(manifest.id, new BridgeConnectorAdapter(manifest));
        } catch (error) {
          process.stderr.write(`Connector manifest skipped: ${String(error?.message ?? error)}\n`);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    // Stored readiness belongs to the previous process. Keep user intent, but
    // reopen transports and validate local executables before advertising tools.
    const state = await this.stateStore.load();
    for (const [profileID, rows] of Object.entries(state.bridgeConnections)) {
      for (const [id, row] of Object.entries(rows)) {
        if (this.manifests.get(id)?.execution !== "bridge") continue;
        await this.stateStore.updateBridgeConnection(profileID, id, {
          desiredConnected: row.desiredConnected === true,
          connected: false, executionReady: false,
          connectionState: row.desiredConnected ? "connecting" : "disconnected",
        });
      }
    }
    this.initialized = true;
    this.restoring = this.reconcileConnections({ force: true }).catch(() => []);
    this.reconnectTimer = setInterval(() => { this.reconcileConnections().catch(() => {}); }, 30_000);
    this.reconnectTimer.unref?.();
    return this;
  }

  async reconcileConnections({ profileID, force = false } = {}) {
    if (this.closed) return [];
    const state = await this.stateStore.load();
    const attempts = [];
    for (const [profile, rows] of Object.entries(state.bridgeConnections)) {
      if (profileID !== undefined && profile !== cleanProfileID(profileID)) continue;
      for (const [id, row] of Object.entries(rows)) {
        if (row.desiredConnected !== true || this.manifests.get(id)?.execution !== "bridge") continue;
        attempts.push(this.restoreConnection(id, profile, { force }));
      }
    }
    return Promise.allSettled(attempts);
  }

  restoreConnection(id, profileID, { force = false } = {}) {
    const manifest = this.manifest(id);
    const operation = this.connectionOperation(manifest, profileID);
    const existing = this.connectionAttempts.get(operation.key);
    if (existing && this.currentOperation(existing.operation)) return existing.promise;
    const attempt = { operation };
    attempt.promise = (async () => {
      const state = await this.stateStore.publicState(profileID);
      this.assertCurrentOperation(operation);
      const row = state.bridgeConnections[id];
      if (!row?.desiredConnected || (row.connected && row.executionReady && !this.clients.get(operation.key)?.closed) ||
          (!force && (row.connectionState === "auth-required" || (this.retryAfter.get(operation.key) ?? 0) > this.now()))) return;
      this.clearTools(id, profileID);
      attempt.operation = this.connectionOperation(manifest, profileID);
      return this.establishConnection(attempt.operation);
    })().finally(() => { if (this.connectionAttempts.get(operation.key) === attempt) this.connectionAttempts.delete(operation.key); });
    this.connectionAttempts.set(operation.key, attempt);
    return attempt.promise;
  }

  async connectionFailed(operation, error) {
    if (!this.currentOperation(operation)) return;
    this.retryAfter.set(operation.key, this.now() + 30_000);
    await this.updateConnection(operation, {
      connected: false, executionReady: false,
      ...(authorizationRequired(error) ? { authenticated: false } : {}),
      connectionState: authorizationRequired(error) ? "auth-required" : "error",
      lastError: String(error?.message ?? error),
    }).catch(() => {});
  }

  async establishConnection(operation) {
    const { manifest, profileID } = operation;
    try {
      await this.updateConnection(operation, { connected: false, executionReady: false, connectionState: "connecting", lastError: null });
      if (manifest.authentication !== "none" && !await this.accessToken(manifest, { profileID })) {
        throw new Error("Connector authorization is missing or expired; reconnect in settings");
      }
      if (manifest.transport === "cli") await access(manifest.command, constants.X_OK).catch(() => { throw new Error("Connector executable is missing or not executable; check its absolute path"); });
      if (manifest.transport === "spark-cli") {
        const check = await this.sparkChecker(manifest.command);
        await this.updateConnection(operation, { sparkVersion: check?.version ?? "1.0.0" });
      }
      await this.updateConnection(operation, { connected: true, authenticated: true });
      await this.discoverTools(manifest.id, { force: true, profileID });
      await this.updateConnection(operation, {
        connected: true, authenticated: true, executionReady: true, connectionState: "connected", lastError: null,
      });
      this.retryAfter.delete(operation.key);
      return { kind: "connected", connector: manifest.id, profileID };
    } catch (error) {
      await this.connectionFailed(operation, error);
      throw error;
    }
  }

  manifest(id) {
    const value = this.manifests.get(cleanConnectorID(id));
    if (!value) throw new Error(`unknown connector: ${id}`);
    return value;
  }

  async observeNativeTools(profileID, tools) {
    const state = await this.stateStore.publicState(profileID);
    const connectorIDs = [...new Set([
      ...nativeSessionCatalog.map((manifest) => manifest.id),
      ...Object.keys(state.nativeConnections),
    ])];
    const connectors = [];
    for (const connectorID of connectorIDs) {
      const capabilities = tools
        .filter((tool) => dynamicNativeConnectorForTool(tool?.name, connectorIDs) === connectorID)
        .map((tool) => tool.name);
      if (capabilities.length === 0) continue;
      connectors.push({ id: connectorID, capabilities });
      await this.stateStore.updateNativeConnection(profileID, connectorID, {
        capabilities,
        schemaAvailable: true,
      });
    }
    // Schemas describe capability, not authentication. Connection truth comes
    // from Dia's browser-local Apps view model so an advertised on-demand tool
    // can never make a disconnected account appear connected.
    return connectors;
  }

  async observeNativeToolResults(profileID, payload) {
    const state = await this.stateStore.publicState(profileID);
    const connectorIDs = [...new Set([
      ...nativeSessionCatalog.map((manifest) => manifest.id),
      ...Object.keys(state.nativeConnections),
    ])];
    const calls = new Map();
    for (const message of payload?.messages ?? []) {
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (message.role === "assistant" && block?.type === "tool_use" && block.id) {
          const connectorID = dynamicNativeConnectorForTool(block.name, connectorIDs);
          if (connectorID) calls.set(block.id, { connectorID, name: block.name });
        } else if (message.role === "user" && block?.type === "tool_result") {
          const call = calls.get(block.tool_use_id);
          if (!call) continue;
          const error = nativeToolResultError(block);
          const authenticationFailed = error && /not connected|unauthorized|authentication|login|sign in|blocked.*dia|dia-owned/i.test(error);
          await this.stateStore.updateNativeConnection(profileID, call.connectorID, {
            connected: error ? !authenticationFailed : true,
            executionReady: !error,
            lastSuccess: error ? null : new Date(this.now()).toISOString(),
            lastError: error,
          });
        }
      }
    }
  }

  async credentialRecord(manifest, profileID = "Default") {
    const operation = this.connectionOperation(manifest, profileID);
    const recordID = credentialRecordID(profileID, manifest.id);
    let record = await this.credentialStore.getRecord(recordID);
    this.assertCurrentOperation(operation);
    if (!record && cleanProfileID(profileID) === "Default" && !manifest.id.includes(".")) {
      const legacyID = `connector.${manifest.id}`;
      const legacy = await this.credentialStore.getRecord(legacyID);
      if (legacy) {
        record = await this.mutate(async () => {
          this.assertCurrentOperation(operation);
          // Another caller may already have migrated or replaced this record.
          const current = await this.credentialStore.getRecord(recordID);
          if (current) return current;
          await this.credentialStore.setRecord(recordID, legacy);
          await this.credentialStore.delete(legacyID);
          return legacy;
        });
      }
    }
    return record;
  }

  async accessToken(manifest, { refresh = true, profileID = "Default" } = {}) {
    if (manifest.authentication === "none") return null;
    const operation = this.connectionOperation(manifest, profileID);
    const recordID = credentialRecordID(profileID, manifest.id);
    const record = await this.credentialRecord(manifest, profileID);
    this.assertCurrentOperation(operation);
    if (!record) return null;
    if (manifest.authentication === "bearer" || !refresh || !record.expiresAt || record.expiresAt > this.now() + 30_000) {
      return record.accessToken ?? null;
    }
    if (!record.refreshToken) return null;
    const key = operation.key;
    if (this.refreshes.has(key)) return this.refreshes.get(key);
    const pending = (async () => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
        client_id: (record.oauth ?? manifest.oauth).clientID,
        resource: (record.oauth ?? manifest.oauth).resource ?? manifest.endpoint,
      });
      const response = await this.fetch(assertAllowedConnectorURL((record.oauth ?? manifest.oauth).tokenURL, manifest.allowedDomains), {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`OAuth refresh returned HTTP ${response.status}`);
      const token = await response.json();
      if (typeof token.access_token !== "string" || !token.access_token) throw new Error("OAuth refresh had no access token");
      const updated = {
        ...record,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? record.refreshToken,
        expiresAt: token.expires_in ? this.now() + Number(token.expires_in) * 1000 : null,
      };
      await this.mutate(async () => {
        this.assertCurrentOperation(operation);
        await this.credentialStore.setRecord(recordID, updated);
      });
      this.assertCurrentOperation(operation);
      return updated.accessToken;
    })().finally(() => { if (this.refreshes.get(key) === pending) this.refreshes.delete(key); });
    this.refreshes.set(key, pending);
    return pending;
  }

  async status(profileID = "Default") {
    const state = await this.stateStore.publicState(profileID);
    const result = [];
    for (const manifest of this.manifests.values()) {
      if (manifest.execution === "native-session") {
        const observed = state.nativeConnections[manifest.id];
        const connected = observed?.connected === true;
        result.push({
          ...manifest,
          ...observed,
          schemaAvailable: observed?.schemaAvailable === true,
          authenticated: connected,
          connected,
          executionReady: connected && observed?.executionReady === true && !observed?.lastError,
          capabilities: observed?.capabilities?.length > 0
            ? observed.capabilities
            : manifest.capabilities,
        });
      } else {
        const record = manifest.authentication !== "none"
          ? await this.credentialRecord(manifest, profileID)
          : {};
        const observed = state.bridgeConnections[manifest.id] ?? {};
        const authenticated = observed.connectionState !== "auth-required" &&
          (manifest.authentication === "none" || Boolean(record?.accessToken));
        result.push({
          ...manifest,
          ...observed,
          schemaAvailable: this.profileTools(manifest.id, profileID).length > 0,
          toolCount: this.profileTools(manifest.id, profileID).length,
          authenticated,
          desiredConnected: observed.desiredConnected === true,
          connectionState: observed.connectionState ?? (observed.connected ? "connected" : "disconnected"),
          connected: authenticated && observed.connected === true,
          executionReady: authenticated && observed.connected === true && observed.executionReady === true,
          accountLabel: observed.accountLabel ?? null,
        });
      }
    }
    // Dia may add browser-session connectors in a future build. Preserve every
    // native row reported by the browser, even when it is not in today's catalog.
    for (const [id, observed] of Object.entries(state.nativeConnections)) {
      if (!this.manifests.has(id)) result.push({
        id,
        displayName: id,
        icon: id,
        execution: "native-session",
        authentication: "browser-session",
        capabilities: observed.capabilities ?? [],
        branded: true,
        ...observed,
        schemaAvailable: observed.schemaAvailable === true,
        authenticated: observed.connected === true,
        executionReady: observed.connected === true && observed.executionReady === true && !observed.lastError,
      });
    }
    return result;
  }

  async connect(id, { profileID = "Default", token, environment } = {}) {
    const manifest = this.manifest(id);
    const selectedProfile = cleanProfileID(profileID);
    if (manifest.execution === "native-session") {
      return { kind: "native-session", connector: manifest.id, profileID: selectedProfile };
    }
    this.clearTools(manifest.id, selectedProfile);
    const operation = this.connectionOperation(manifest, selectedProfile);
    const attempt = { operation };
    attempt.promise = this.connectWithCredentials(operation, { token, environment })
      .catch(async (error) => { await this.connectionFailed(operation, error); throw error; })
      .finally(() => { if (this.connectionAttempts.get(operation.key) === attempt) this.connectionAttempts.delete(operation.key); });
    this.connectionAttempts.set(operation.key, attempt);
    return attempt.promise;
  }

  async connectWithCredentials(operation, { token, environment }) {
    const { manifest, profileID: selectedProfile } = operation;
    const id = manifest.id;
    await this.updateConnection(operation, {
      desiredConnected: true, connected: false, executionReady: false, connectionState: "connecting", lastError: null,
    });
    for (const [key, pending] of this.oauthStates) {
      if (pending.expiresAt < this.now() || (pending.connectorID === id && pending.profileID === selectedProfile)) this.oauthStates.delete(key);
    }
    if (manifest.authentication !== "oauth") {
      if (environment !== undefined) {
        if (!["stdio", "cli"].includes(manifest.transport)) throw new Error("Only local connectors accept environment credentials");
        processEnvironment(manifest, environment);
        await this.mutate(async () => {
          this.assertCurrentOperation(operation);
          await this.credentialStore.setRecord(credentialRecordID(selectedProfile, id), { environment });
        });
      }
      if (manifest.authentication === "bearer") {
        if (typeof token === "string" && token.trim()) {
          if (/[\r\n\0]/.test(token) || token.length > 16000) throw new Error("Invalid bearer token");
          await this.mutate(async () => {
            this.assertCurrentOperation(operation);
            await this.credentialStore.setRecord(credentialRecordID(selectedProfile, id), { accessToken: token.trim() });
          });
        }
        if (!await this.accessToken(manifest, { profileID: selectedProfile })) throw new Error("A bearer token is required");
      }
      return this.establishConnection(operation);
    }
    const previous = await this.credentialRecord(manifest, selectedProfile);
    if (previous?.accessToken) {
      try { return await this.establishConnection(operation); }
      catch (error) { if (!authorizationRequired(error)) throw error; }
    }
    const oauth = await discoverOAuth(manifest, { fetchImplementation: this.fetch, callbackURL: this.callbackBaseURL, registered: previous?.oauth });
    this.assertCurrentOperation(operation);
    // Persist registration separately from access tokens so retries reuse the public client ID.
    await this.mutate(async () => {
      this.assertCurrentOperation(operation);
      await this.credentialStore.setRecord(credentialRecordID(selectedProfile, id), { ...previous, oauth });
    });
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.oauthStates.set(state, {
      connectorID: manifest.id,
      profileID: selectedProfile,
      operation,
      verifier,
      oauth,
      expiresAt: this.now() + 10 * 60_000,
    });
    const url = new URL(oauth.authorizationURL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", oauth.clientID);
    url.searchParams.set("resource", oauth.resource);
    url.searchParams.set("redirect_uri", this.callbackBaseURL);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (oauth.scopes.length > 0) url.searchParams.set("scope", oauth.scopes.join(" "));
    await this.updateConnection(operation, { connected: false, authenticated: false, executionReady: false, connectionState: "auth-required" });
    return { kind: "oauth", connector: manifest.id, profileID: selectedProfile, authorizationURL: url.toString() };
  }

  async completeOAuth({ state, code, error }) {
    const pending = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    if (!pending || pending.expiresAt < this.now()) throw new Error("invalid or expired one-use OAuth state");
    const attempt = { operation: pending.operation };
    attempt.promise = this.completeOAuthExchange(pending, { code, error })
      .catch(async (failure) => { await this.connectionFailed(pending.operation, failure); throw failure; })
      .finally(() => { if (this.connectionAttempts.get(pending.operation.key) === attempt) this.connectionAttempts.delete(pending.operation.key); });
    this.connectionAttempts.set(pending.operation.key, attempt);
    return attempt.promise;
  }

  async completeOAuthExchange(pending, { code, error }) {
    if (error) throw new Error(`OAuth was not completed: ${error}`);
    if (!code) throw new Error("OAuth callback did not contain a code");
    const manifest = this.manifest(pending.connectorID);
    const operation = pending.operation;
    this.assertCurrentOperation(operation);
    const oauth = pending.oauth;
    const response = await this.fetch(assertAllowedConnectorURL(oauth.tokenURL, manifest.allowedDomains), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: oauth.clientID,
        resource: oauth.resource,
        redirect_uri: this.callbackBaseURL,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OAuth token exchange returned HTTP ${response.status}`);
    const token = await response.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("OAuth token response had no access token");
    const recordID = credentialRecordID(pending.profileID, manifest.id);
    await this.mutate(async () => {
      this.assertCurrentOperation(operation);
      await this.credentialStore.setRecord(recordID, {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenType: token.token_type ?? "Bearer",
        scope: token.scope ?? oauth.scopes.join(" "),
        oauth,
        expiresAt: token.expires_in ? this.now() + Number(token.expires_in) * 1000 : null,
      });
      await this.stateStore.updateBridgeConnection(pending.profileID, manifest.id, { desiredConnected: true, connected: false, executionReady: false });
    });
    this.assertCurrentOperation(operation);
    await this.establishConnection(operation);
    return { ok: true, connector: manifest.id, profileID: pending.profileID };
  }

  async disconnect(id, { profileID = "Default" } = {}) {
    const manifest = this.manifest(id);
    const selectedProfile = cleanProfileID(profileID);
    if (manifest.execution === "native-session") {
      return { kind: "native-session", connector: id, profileID: selectedProfile };
    }
    this.clearTools(manifest.id, selectedProfile);
    const operation = this.connectionOperation(manifest, selectedProfile);
    for (const [key, pending] of this.oauthStates) {
      if (pending.connectorID === id && pending.profileID === selectedProfile) this.oauthStates.delete(key);
    }
    const recordID = credentialRecordID(selectedProfile, manifest.id);
    const token = await this.mutate(async () => {
      this.assertCurrentOperation(operation);
      // Persist the user's off choice before any credential-store failure can
      // interrupt cleanup; credentials alone must never opt a profile back in.
      await this.stateStore.updateBridgeConnection(selectedProfile, manifest.id, {
        desiredConnected: false, connected: false, authenticated: false, executionReady: false, connectionState: "disconnected", lastError: null,
      });
      const record = await this.credentialStore.getRecord(recordID) ??
        (selectedProfile === "Default" && !manifest.id.includes(".") ? await this.credentialStore.getRecord(`connector.${manifest.id}`) : null);
      await this.credentialStore.delete(recordID);
      if (selectedProfile === "Default" && !manifest.id.includes(".")) await this.credentialStore.delete(`connector.${manifest.id}`);
      return record;
    });
    const oauth = token?.oauth ?? manifest.oauth;
    if (token?.accessToken && oauth?.revocationURL) {
      try {
        await this.fetch(assertAllowedConnectorURL(oauth.revocationURL, manifest.allowedDomains), {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: token.accessToken, client_id: oauth.clientID }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Local deletion still disconnects; remote revocation may be retried by the provider.
      }
    }
    return { ok: true, connector: manifest.id, profileID: selectedProfile };
  }

  profileKey(id, profileID) { return JSON.stringify([cleanProfileID(profileID), id]); }

  connectionOperation(manifest, profileID) {
    const key = this.profileKey(manifest.id, profileID);
    if (!this.generations.has(key)) this.generations.set(key, 0);
    return { manifest, profileID: cleanProfileID(profileID), key, generation: this.generations.get(key) };
  }

  currentOperation(operation) {
    return !this.closed && this.manifests.get(operation.manifest.id) === operation.manifest &&
      this.generations.get(operation.key) === operation.generation;
  }

  assertCurrentOperation(operation) {
    if (!this.currentOperation(operation)) throw new Error("Connector changed during authorization or connection; retry from settings");
  }

  async updateConnection(operation, patch) {
    return this.mutate(async () => {
      this.assertCurrentOperation(operation);
      return this.stateStore.updateBridgeConnection(operation.profileID, operation.manifest.id, patch);
    });
  }

  profileTools(id, profileID) {
    return [...this.toolMap.values()].filter((item) => item.connectorID === id && item.profileID === cleanProfileID(profileID));
  }

  clearTools(id, profileID) {
    if (profileID !== undefined) {
      const key = this.profileKey(id, profileID);
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      this.refreshes.delete(key);
      this.syncs.delete(key);
    } else {
      for (const [key, generation] of this.generations) {
        if (JSON.parse(key)[1] === id) {
          this.generations.set(key, generation + 1);
          this.refreshes.delete(key);
          this.syncs.delete(key);
        }
      }
    }
    for (const [key, tool] of this.toolMap) {
      if (tool.connectorID === id && (profileID === undefined || tool.profileID === cleanProfileID(profileID))) this.toolMap.delete(key);
    }
    for (const key of this.clients.keys()) {
      const [profile, connector] = JSON.parse(key);
      if (connector === id && (profileID === undefined || profile === cleanProfileID(profileID))) {
        this.clients.get(key)?.close?.();
        this.clients.delete(key);
      }
    }
    // In-flight discovery must not re-publish tools after disconnect/edit.
    for (const key of this.discovery.keys()) {
      const [profile, connector] = JSON.parse(key);
      if (connector === id && (profileID === undefined || profile === cleanProfileID(profileID))) this.discovery.delete(key);
    }
  }

  async requireConnection(manifest, profileID) {
    const operation = this.connectionOperation(manifest, profileID);
    const state = await this.stateStore.publicState(profileID);
    if (state.bridgeConnections[manifest.id]?.desiredConnected !== true || state.bridgeConnections[manifest.id]?.connected !== true) throw new Error("Connector is disconnected; connect it in settings");
    if (manifest.authentication !== "none" && !await this.accessToken(manifest, { profileID })) throw new Error("Connector authorization is missing or expired; reconnect in settings");
    this.assertCurrentOperation(operation);
  }

  client(manifest, profileID) {
    const key = this.profileKey(manifest.id, profileID);
    const operation = this.connectionOperation(manifest, profileID);
    const Client = manifest.transport === "stdio" ? MCPStdioClient : manifest.transport === "http-sse" ? MCPSSEClient : MCPHTTPClient;
    if (!this.clients.has(key)) this.clients.set(key, new Client(manifest, {
      spawnImplementation: this.spawnImplementation,
      environment: async () => (await this.credentialRecord(manifest, profileID))?.environment ?? {},
      fetchImplementation: this.fetch,
      accessToken: async () => {
        this.assertCurrentOperation(operation);
        const token = await this.accessToken(manifest, { profileID });
        this.assertCurrentOperation(operation);
        return token;
      },
    }));
    return this.clients.get(key);
  }

  async discoverTools(id, { force = false, profileID = "Default" } = {}) {
    const manifest = this.manifest(id);
    if (manifest.execution !== "bridge") return [];
    const selectedProfile = cleanProfileID(profileID);
    const operation = this.connectionOperation(manifest, selectedProfile);
    try { await this.requireConnection(manifest, selectedProfile); }
    catch (error) {
      // Validation can fail before discovery starts (for example an expired
      // OAuth token with no refresh token). Surface that state for reconnect.
      const state = await this.stateStore.publicState(selectedProfile);
      if (state.bridgeConnections[id]?.desiredConnected) await this.connectionFailed(operation, error);
      throw error;
    }
    this.assertCurrentOperation(operation);
    const existing = this.profileTools(id, selectedProfile);
    if (!force && existing.length > 0) return existing.map((item) => structuredClone(item.definition));
    const key = this.profileKey(id, selectedProfile);
    if (this.discovery.has(key)) return this.discovery.get(key);
    const pending = (async () => {
      const remoteTools = [];
      if (manifest.transport === "spark-cli") {
        const state = await this.stateStore.publicState(selectedProfile);
        remoteTools.push(...sparkToolsForVersion(state.bridgeConnections[id]?.sparkVersion));
      }
      else if (manifest.transport === "cli") remoteTools.push(...manifest.tools);
      else {
        const cursors = new Set();
        let cursor;
        do {
          const result = await this.client(manifest, selectedProfile).request("tools/list", cursor ? { cursor } : {});
          if (!Array.isArray(result?.tools)) throw new Error("MCP tools/list response has no tools array");
          remoteTools.push(...result.tools);
          if (remoteTools.length > 1000) throw new Error("Connector advertises more than 1000 tools");
          cursor = result.nextCursor;
          if (cursor !== undefined && cursor !== null && (typeof cursor !== "string" || cursors.has(cursor) || cursors.size >= 100)) throw new Error("Invalid or repeated MCP tools cursor");
          if (cursor) cursors.add(cursor);
        } while (cursor);
      }
      const definitions = new Map();
      for (const remote of remoteTools) {
        if (typeof remote?.name !== "string" || !remote.name) throw new Error("MCP tool has no name");
        const name = toolName(id, remote.name);
        if (definitions.has(name)) throw new Error("MCP tools have colliding names");
        if (remote.inputSchema && (remote.inputSchema.type !== "object" || Array.isArray(remote.inputSchema))) throw new Error("MCP tool inputSchema must describe an object");
        definitions.set(name, { connectorID: id, profileID: selectedProfile, remoteName: remote.name, annotations: remote.annotations ?? {}, definition: {
          name, description: `${manifest.displayName}: ${remote.description ?? remote.name}`,
          input_schema: remote.inputSchema ?? { type: "object", additionalProperties: true }, annotations: remote.annotations ?? {}, source: "local",
        } });
      }
      await this.requireConnection(manifest, selectedProfile);
      await this.mutate(async () => {
        this.assertCurrentOperation(operation);
        if (this.discovery.get(key) !== pending) throw new Error("Connector changed during discovery; retry");
        for (const [toolKey, tool] of this.toolMap) if (tool.connectorID === id && tool.profileID === selectedProfile) this.toolMap.delete(toolKey);
        for (const [name, tool] of definitions) this.toolMap.set(this.profileKey(name, selectedProfile), tool);
        await this.stateStore.updateBridgeConnection(selectedProfile, id, { executionReady: true, lastError: null });
      });
      return [...definitions.values()].map((item) => structuredClone(item.definition));
    })().catch(async (error) => {
      if (this.discovery.get(key) === pending) {
        for (const [toolKey, tool] of this.toolMap) if (tool.connectorID === id && tool.profileID === selectedProfile) this.toolMap.delete(toolKey);
        await this.connectionFailed(operation, error);
      }
      throw error;
    }).finally(() => { if (this.discovery.get(key) === pending) this.discovery.delete(key); });
    this.discovery.set(key, pending);
    return pending;
  }

  async definitions(profileID = "Default") {
    const selectedProfile = cleanProfileID(profileID);
    await this.reconcileConnections({ profileID: selectedProfile });
    const state = await this.stateStore.publicState(selectedProfile);
    const results = await Promise.all([...this.manifests.values()].filter((manifest) =>
      manifest.execution === "bridge" && state.bridgeConnections[manifest.id]?.connected === true)
      .map((manifest) => this.discoverTools(manifest.id, { profileID: selectedProfile }).catch(() => [])));
    return results.flat();
  }

  isTool(name) {
    return [...this.toolMap.values()].some((tool) => tool.definition.name === name);
  }

  async execute(name, input, { profileID = "Default" } = {}) {
    const selectedProfile = cleanProfileID(profileID);
    const tool = this.toolMap.get(this.profileKey(name, selectedProfile));
    if (!tool) throw new Error(`Unknown or disconnected connector tool: ${name}`);
    const manifest = this.manifest(tool.connectorID);
    const operation = this.connectionOperation(manifest, selectedProfile);
    try {
      await this.requireConnection(manifest, selectedProfile);
      this.assertCurrentOperation(operation);
      const result = manifest.transport === "spark-cli"
        ? { content: [{ type: "text", text: await this.sparkRunner(manifest.command, sparkArguments(tool.remoteName, input)) }] }
        : manifest.transport === "cli"
          ? await executeCLI(manifest, tool.remoteName, input, { runner: this.processRunner,
            environment: (await this.credentialRecord(manifest, selectedProfile))?.environment ?? {} })
          : await this.client(manifest, selectedProfile).request("tools/call", { name: tool.remoteName, arguments: input ?? {} });
      if (result?.isError) throw new Error(`${manifest.displayName} reported a tool error; check the request and retry`);
      if (this.currentOperation(operation)) {
        const state = await this.stateStore.publicState(selectedProfile);
        if (state.bridgeConnections[manifest.id]?.connected) await this.updateConnection(operation, {
          executionReady: true, lastSuccess: new Date(this.now()).toISOString(), lastError: null,
        }).catch(() => {});
      }
      return result;
    } catch (error) {
      await this.connectionFailed(operation, error);
      throw error;
    }
  }

  async sync(id, { profileID = "Default" } = {}) {
    const manifest = this.manifest(id);
    if (!manifest.sync) return { supported: false, records: [], cursor: null };
    if (!this.onSync) throw new Error("Connector indexing is unavailable; configure a sync destination");
    const selectedProfile = cleanProfileID(profileID);
    const operation = this.connectionOperation(manifest, selectedProfile);
    if (this.syncs.has(operation.key)) return this.syncs.get(operation.key);
    const pending = (async () => {
      await this.discoverTools(id, { profileID: selectedProfile });
      const tool = this.profileTools(id, selectedProfile).find((item) => item.remoteName === manifest.sync.tool);
      if (!tool || tool.annotations.readOnlyHint !== true) throw new Error("Connector sync requires an advertised read-only tool");
      const state = await this.stateStore.publicState(selectedProfile);
      const previousCursor = state.bridgeConnections[id]?.syncCursor ?? null;
      const result = await this.execute(tool.definition.name, { ...manifest.sync.arguments,
        ...(previousCursor !== null ? { [manifest.sync.cursorArgument]: previousCursor } : {}),
      }, { profileID: selectedProfile });
      const batch = result.structuredContent ?? JSON.parse(contentAsText(result.content));
      if (!Array.isArray(batch?.records) || batch.records.length > 5000 || batch.records.some((record) =>
        !record || typeof record !== "object" || Array.isArray(record) || typeof record.id !== "string" || !record.id)) throw new Error("Sync response requires up to 5000 records with stable string IDs");
      const deletedIDs = batch.deletedIDs ?? [];
      if (!Array.isArray(deletedIDs) || deletedIDs.length > 5000 || deletedIDs.some((id) => typeof id !== "string" || !id || id.length > 4000)) throw new Error("Invalid sync deletedIDs");
      const cursor = batch.cursor ?? null;
      if (cursor !== null && (typeof cursor !== "string" || cursor.length > 16000)) throw new Error("Invalid sync cursor");
      this.assertCurrentOperation(operation);
      await this.onSync({ connectorID: id, label: manifest.displayName, profileID: selectedProfile,
        records: batch.records, deletedIDs, cursor, previousCursor });
      await this.updateConnection(operation, { syncCursor: cursor, lastSync: new Date(this.now()).toISOString(), lastSyncError: null });
      return { supported: true, imported: batch.records.length, deleted: deletedIDs.length, cursor };
    })().catch(async (error) => {
      await this.updateConnection(operation, { lastSyncError: String(error.message) }).catch(() => {});
      throw error;
    }).finally(() => { if (this.syncs.get(operation.key) === pending) this.syncs.delete(operation.key); });
    this.syncs.set(operation.key, pending);
    return pending;
  }

  close() {
    this.closed = true;
    clearInterval(this.reconnectTimer);
    for (const client of this.clients.values()) client.close?.();
    this.clients.clear();
    this.toolMap.clear();
  }

  mutate(operation) {
    const pending = this.mutations.then(operation);
    this.mutations = pending.catch(() => {});
    return pending;
  }

  async forgetManifestConnections(id) {
    this.clearTools(id);
    for (const [key, pending] of this.oauthStates) if (pending.connectorID === id) this.oauthStates.delete(key);
    const state = await this.stateStore.load();
    const profiles = new Set(Object.keys(state.bridgeConnections));
    // Authorization may have started before the first connection state row.
    // Include those profiles so editing cannot leave a newly written old token.
    for (const key of this.generations.keys()) {
      const [profileID, connectorID] = JSON.parse(key);
      if (connectorID === id) profiles.add(profileID);
    }
    profiles.add("Default");
    if (!id.includes(".")) await this.credentialStore.delete(`connector.${id}`);
    for (const profileID of profiles) await this.credentialStore.delete(credentialRecordID(profileID, id));
    for (const profileID of profiles) await this.stateStore.updateBridgeConnection(profileID, id, { desiredConnected: false, connected: false, authenticated: false, executionReady: false, connectionState: "disconnected", lastError: null, syncCursor: null, lastSync: null, lastSyncError: null });
  }

  async addManifest(value) {
    return this.mutate(async () => {
      const manifest = validateManifest(value);
      const existing = this.manifests.get(manifest.id);
      if (existing?.execution === "native-session") throw new Error("Native connectors cannot be edited");
      // Do not persist token/header/env fields from pasted configurations.
      if (JSON.stringify(value).length > 128 * 1024) throw new Error("Connector manifest is too large");
      if (existing) await this.forgetManifestConnections(manifest.id);
      const path = this.manifestPaths.get(manifest.id) ?? resolve(this.manifestDirectory, `${manifest.id}.json`);
      await mkdir(this.manifestDirectory, { recursive: true, mode: 0o700 });
      await chmod(this.manifestDirectory, 0o700);
      const temporary = `${path}.tmp-${randomBytes(8).toString("hex")}`;
      try {
        await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
      this.manifestPaths.set(manifest.id, path);
      this.manifests.set(manifest.id, manifest);
      this.adapters.set(manifest.id, new BridgeConnectorAdapter(manifest));
      return structuredClone(manifest);
    });
  }

  async removeManifest(id) {
    return this.mutate(async () => {
      const manifest = this.manifest(id);
      if (manifest.execution !== "bridge") throw new Error("Native connectors cannot be removed");
      await this.forgetManifestConnections(id);
      const path = this.manifestPaths.get(id);
      if (path) await rm(path, { force: true });
      this.manifestPaths.delete(id);
      this.manifests.delete(id);
      this.adapters.delete(id);
      return { ok: true };
    });
  }

}

export {
  credentialRecordID,
  nativeConnectorForTool,
  dynamicNativeConnectorForTool,
  nativeSessionCatalog,
  toolName,
  validateManifest,
};
