import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cleanConnectorID } from "../apps-state.js";
import { assertAllowedConnectorURL } from "../network-policy.js";
import { connectorManifestDirectory } from "../paths.js";

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
  const execution = value?.execution ?? "bridge";
  if (execution !== "bridge") throw new Error(`${path}: custom connectors must use bridge execution`);
  const authentication = value?.authentication ?? "none";
  if (!["none", "oauth"].includes(authentication)) {
    throw new Error(`${path}: authentication must be none or oauth`);
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
    authentication,
    capabilities: Array.isArray(value?.capabilities)
      ? value.capabilities.filter((item) => typeof item === "string").slice(0, 100)
      : [],
    allowedDomains: Array.isArray(value?.allowedDomains) ? value.allowedDomains : [],
    endpoint,
    branded: false,
  };
  if (authentication === "oauth") {
    manifest.oauth = {
      authorizationURL: assertAllowedConnectorURL(
        value?.oauth?.authorizationURL,
        manifest.allowedDomains,
      ).toString(),
      tokenURL: assertAllowedConnectorURL(value?.oauth?.tokenURL, manifest.allowedDomains).toString(),
      revocationURL: value?.oauth?.revocationURL
        ? assertAllowedConnectorURL(value.oauth.revocationURL, manifest.allowedDomains).toString()
        : null,
      clientID: typeof value?.oauth?.clientID === "string" ? value.oauth.clientID : "",
      scopes: Array.isArray(value?.oauth?.scopes)
        ? value.oauth.scopes.filter((item) => typeof item === "string")
        : [],
    };
    if (!manifest.oauth.clientID) throw new Error(`${path}: oauth.clientID is required`);
  }
  return manifest;
}

function toolName(connectorID, remoteName) {
  const safe = String(remoteName).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  return `mcp__custom_${connectorID.replaceAll("-", "_")}__${safe}`;
}

async function mcpRequest(fetchImplementation, manifest, method, params, accessToken = null) {
  const endpoint = assertAllowedConnectorURL(manifest.endpoint, manifest.allowedDomains);
  const response = await fetchImplementation(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomBytes(8).toString("hex"), method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${manifest.displayName} MCP returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  let payload;
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
    payload = JSON.parse(data ?? "null");
  } else {
    payload = await response.json();
  }
  if (payload?.error) throw new Error(payload.error.message ?? "MCP request failed");
  return payload?.result ?? payload;
}

export class ConnectorRegistry {
  constructor({
    stateStore,
    credentialStore,
    manifestDirectory = connectorManifestDirectory,
    fetchImplementation = fetch,
    callbackBaseURL = "http://127.0.0.1:8765/api/apps/oauth/callback",
    now = () => Date.now(),
  }) {
    this.stateStore = stateStore;
    this.credentialStore = credentialStore;
    this.manifestDirectory = manifestDirectory;
    this.fetch = fetchImplementation;
    this.callbackBaseURL = callbackBaseURL;
    this.now = now;
    this.manifests = new Map(nativeSessionCatalog.map((item) => [item.id, item]));
    this.adapters = new Map(nativeSessionCatalog.map((item) =>
      [item.id, new NativeSessionAdapter(item)]));
    this.oauthStates = new Map();
    this.toolMap = new Map();
  }

  async initialize() {
    try {
      for (const file of await readdir(this.manifestDirectory)) {
        if (!file.endsWith(".json")) continue;
        try {
          const path = resolve(this.manifestDirectory, file);
          const manifest = validateManifest(JSON.parse(await readFile(path, "utf8")), path);
          this.manifests.set(manifest.id, manifest);
          this.adapters.set(manifest.id, new BridgeConnectorAdapter(manifest));
        } catch (error) {
          process.stderr.write(`Connector manifest skipped: ${String(error?.message ?? error)}\n`);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this;
  }

  manifest(id) {
    const value = this.manifests.get(cleanConnectorID(id));
    if (!value) throw new Error(`unknown connector: ${id}`);
    return value;
  }

  async observeNativeTools(profileID, tools) {
    const names = tools.map((tool) => String(tool?.name ?? "").toLowerCase());
    const connectors = [];
    for (const manifest of nativeSessionCatalog) {
      const capabilities = manifest.capabilities.filter((capability) => {
        const words = capability.toLowerCase().split("_");
        return names.some((name) => words.every((word) => name.includes(word)) ||
          name.includes(manifest.id.replace("google-", "").replace("-", "_")));
      });
      if (capabilities.length > 0) connectors.push({
        id: manifest.id,
        connected: true,
        autoConnected: true,
        capabilities,
      });
    }
    // Schemas describe capability, not authentication. Connection truth comes
    // from Dia's browser-local Apps view model so an advertised on-demand tool
    // can never make a disconnected account appear connected.
    return connectors;
  }

  async accessToken(manifest, { refresh = true } = {}) {
    if (manifest.authentication !== "oauth") return null;
    const recordID = `connector.${manifest.id}`;
    const record = await this.credentialStore.getRecord(recordID);
    if (!record) return null;
    if (!refresh || !record.expiresAt || record.expiresAt > this.now() + 30_000) {
      return record.accessToken ?? null;
    }
    if (!record.refreshToken) return null;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: record.refreshToken,
      client_id: manifest.oauth.clientID,
    });
    const response = await this.fetch(manifest.oauth.tokenURL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OAuth refresh returned HTTP ${response.status}`);
    const token = await response.json();
    const updated = {
      ...record,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? record.refreshToken,
      expiresAt: token.expires_in ? this.now() + Number(token.expires_in) * 1000 : null,
    };
    await this.credentialStore.setRecord(recordID, updated);
    return updated.accessToken;
  }

  async status(profileID = "Default") {
    const state = await this.stateStore.publicState(profileID);
    const result = [];
    for (const manifest of this.manifests.values()) {
      if (manifest.execution === "native-session") {
        const observed = state.nativeConnections[manifest.id];
        result.push({
          ...manifest,
          ...observed,
          connected: observed?.connected === true,
          capabilities: observed?.capabilities?.length > 0
            ? observed.capabilities
            : manifest.capabilities,
        });
      } else {
        const record = manifest.authentication === "oauth"
          ? await this.credentialStore.getRecord(`connector.${manifest.id}`)
          : {};
        result.push({
          ...manifest,
          connected: manifest.authentication === "none" || Boolean(record?.accessToken),
          accountLabel: state.bridgeConnections[manifest.id]?.accountLabel ?? null,
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
      });
    }
    return result;
  }

  async connect(id) {
    const manifest = this.manifest(id);
    if (manifest.execution === "native-session") {
      return { kind: "native-session", connector: manifest.id };
    }
    if (manifest.authentication === "none") {
      await this.discoverTools(manifest.id, { force: true });
      return { kind: "connected", connector: manifest.id };
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.oauthStates.set(state, { connectorID: manifest.id, verifier, expiresAt: this.now() + 10 * 60_000 });
    const url = new URL(manifest.oauth.authorizationURL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", manifest.oauth.clientID);
    url.searchParams.set("redirect_uri", this.callbackBaseURL);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (manifest.oauth.scopes.length > 0) url.searchParams.set("scope", manifest.oauth.scopes.join(" "));
    return { kind: "oauth", connector: manifest.id, authorizationURL: url.toString() };
  }

  async completeOAuth({ state, code, error }) {
    const pending = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    if (!pending || pending.expiresAt < this.now()) throw new Error("invalid or expired one-use OAuth state");
    if (error) throw new Error(`OAuth was not completed: ${error}`);
    if (!code) throw new Error("OAuth callback did not contain a code");
    const manifest = this.manifest(pending.connectorID);
    const response = await this.fetch(manifest.oauth.tokenURL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: manifest.oauth.clientID,
        redirect_uri: this.callbackBaseURL,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OAuth token exchange returned HTTP ${response.status}`);
    const token = await response.json();
    if (typeof token.access_token !== "string") throw new Error("OAuth token response had no access token");
    await this.credentialStore.setRecord(`connector.${manifest.id}`, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenType: token.token_type ?? "Bearer",
      scope: token.scope ?? manifest.oauth.scopes.join(" "),
      expiresAt: token.expires_in ? this.now() + Number(token.expires_in) * 1000 : null,
    });
    await this.discoverTools(manifest.id, { force: true });
    return { ok: true, connector: manifest.id };
  }

  async disconnect(id) {
    const manifest = this.manifest(id);
    if (manifest.execution === "native-session") return { kind: "native-session", connector: id };
    const recordID = `connector.${manifest.id}`;
    const token = await this.credentialStore.getRecord(recordID);
    if (token?.accessToken && manifest.oauth?.revocationURL) {
      try {
        await this.fetch(manifest.oauth.revocationURL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: token.accessToken, client_id: manifest.oauth.clientID }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Local deletion still disconnects; remote revocation may be retried by the provider.
      }
    }
    await this.credentialStore.delete(recordID);
    for (const [name, value] of this.toolMap) {
      if (value.connectorID === manifest.id) this.toolMap.delete(name);
    }
    return { ok: true, connector: manifest.id };
  }

  async discoverTools(id, { force = false } = {}) {
    const manifest = this.manifest(id);
    if (manifest.execution !== "bridge") return [];
    const existing = [...this.toolMap.values()].filter((item) => item.connectorID === manifest.id);
    if (!force && existing.length > 0) return existing.map((item) => item.definition);
    const result = await mcpRequest(this.fetch, manifest, "tools/list", {}, await this.accessToken(manifest));
    for (const remote of result?.tools ?? []) {
      if (typeof remote?.name !== "string") continue;
      const name = toolName(manifest.id, remote.name);
      const definition = {
        name,
        description: `${manifest.displayName}: ${remote.description ?? remote.name}`,
        input_schema: remote.inputSchema ?? { type: "object", additionalProperties: true },
        source: "local",
      };
      this.toolMap.set(name, { connectorID: manifest.id, remoteName: remote.name, definition });
    }
    return [...this.toolMap.values()]
      .filter((item) => item.connectorID === manifest.id).map((item) => item.definition);
  }

  async definitions() {
    for (const manifest of this.manifests.values()) {
      if (manifest.execution !== "bridge") continue;
      try { await this.discoverTools(manifest.id); } catch { /* disconnected/unavailable */ }
    }
    return [...this.toolMap.values()].map((item) => structuredClone(item.definition));
  }

  isTool(name) {
    return this.toolMap.has(name);
  }

  async execute(name, input) {
    const tool = this.toolMap.get(name);
    if (!tool) throw new Error(`unknown connector tool: ${name}`);
    const manifest = this.manifest(tool.connectorID);
    return mcpRequest(this.fetch, manifest, "tools/call", {
      name: tool.remoteName,
      arguments: input ?? {},
    }, await this.accessToken(manifest));
  }
}

export { nativeSessionCatalog, toolName, validateManifest };
