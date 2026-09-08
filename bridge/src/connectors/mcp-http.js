import { randomBytes } from "node:crypto";
import { assertAllowedConnectorURL } from "../network-policy.js";

const supportedVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const maximumResponseBytes = 4 * 1024 * 1024;

// Read until the matching response, not until an SSE server closes its stream.
async function readRPC(response, id) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("MCP response had no body");
  const decoder = new TextDecoder();
  const streaming = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  let buffer = "";
  let bytes = 0;
  function result(payload) {
    if (payload?.jsonrpc !== "2.0" || payload.id !== id) return null;
    if (payload.error) throw new Error(`MCP request failed (${payload.error.code ?? "unknown"})`);
    if (!Object.hasOwn(payload, "result")) throw new Error("MCP response has no result");
    return { value: payload.result };
  }
  function event(raw) {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return null;
    return result(JSON.parse(data));
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) bytes += value.byteLength;
      if (bytes > maximumResponseBytes) throw new Error("MCP response exceeds 4 MiB");
      buffer += decoder.decode(value, { stream: !done });
      if (streaming) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const found = event(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (found) return found.value;
        }
        if (done && buffer.trim()) {
          const found = event(buffer);
          if (found) return found.value;
        }
      } else if (done) {
        const found = result(JSON.parse(buffer));
        if (found) return found.value;
      }
      if (done) throw new Error("MCP response did not match the request ID");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class MCPHTTPClient {
  constructor(manifest, { fetchImplementation = fetch, accessToken = async () => null } = {}) {
    this.manifest = manifest;
    this.fetch = fetchImplementation;
    this.accessToken = accessToken;
    this.sessionID = null;
    this.protocolVersion = null;
    this.initializing = null;
  }

  async post(method, params, { notification = false } = {}) {
    const token = await this.accessToken();
    if (this.manifest.authentication !== "none" && !token) {
      throw new Error("Connector authorization is missing or expired; reconnect in settings");
    }
    const id = randomBytes(12).toString("hex");
    const response = await this.fetch(assertAllowedConnectorURL(this.manifest.endpoint, this.manifest.allowedDomains), {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(this.sessionID ? { "Mcp-Session-Id": this.sessionID } : {}),
        ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(!notification ? { id } : {}), method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || response.status >= 300) {
      await response.body?.cancel().catch(() => {});
      const error = new Error(`${this.manifest.displayName} MCP returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (notification) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const result = await readRPC(response, id);
    if (method === "initialize") {
      const session = response.headers.get("mcp-session-id");
      if (session && (!/^[\x21-\x7e]+$/.test(session) || session.length > 2048)) {
        throw new Error("Invalid MCP session ID");
      }
      this.sessionID = session;
    }
    return result;
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    if (this.protocolVersion) return;
    if (!this.initializing) this.initializing = (async () => {
      const result = await this.post("initialize", {
        protocolVersion: supportedVersions[0],
        capabilities: {},
        clientInfo: { name: "dia-custom", version: "0.2.0" },
      });
      if (!supportedVersions.includes(result?.protocolVersion)) throw new Error("Unsupported MCP protocol version");
      this.protocolVersion = result.protocolVersion;
      await this.post("notifications/initialized", {}, { notification: true });
    })().catch((error) => {
      this.protocolVersion = null;
      this.sessionID = null;
      throw error;
    }).finally(() => { this.initializing = null; });
    await this.initializing;
  }

  async request(method, params) {
    await this.initialize();
    try {
      return await this.post(method, params);
    } catch (error) {
      if (error.status === 404 && this.sessionID) {
        this.sessionID = null;
        this.protocolVersion = null;
        // Discovery is safe to retry. Never replay a possibly completed write.
        if (method === "tools/list") {
          await this.initialize();
          return this.post(method, params);
        }
      }
      throw error;
    }
  }
}
