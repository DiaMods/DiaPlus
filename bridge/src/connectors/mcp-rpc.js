import { randomBytes } from "node:crypto";

export const supportedMCPVersions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const maximumMCPMessageBytes = 4 * 1024 * 1024;

// Shared request correlation for persistent stdio and legacy SSE transports.
export class PersistentMCPClient {
  constructor(manifest) {
    this.manifest = manifest;
    this.pending = new Map();
    this.protocolVersion = null;
    this.initializing = null;
    this.closed = false;
  }

  receive(payload) {
    if (payload?.jsonrpc !== "2.0") throw new Error("Invalid MCP JSON-RPC message");
    if (payload.method && Object.hasOwn(payload, "id")) {
      // Sampling, elicitation and roots are deliberately not advertised.
      void this.send({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "Client capability is not available" } }).catch(() => {});
      return;
    }
    if (payload.method) return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);
    clearTimeout(pending.timer);
    if (payload.error) pending.reject(new Error(`MCP request failed (${payload.error.code ?? "unknown"})`));
    else if (!Object.hasOwn(payload, "result")) pending.reject(new Error("MCP response has no result"));
    else pending.resolve(payload.result);
  }

  fail(error) {
    this.protocolVersion = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async rpc(method, params, { notification = false } = {}) {
    if (this.closed) throw new Error("Connector transport is closed; reconnect in settings");
    const id = randomBytes(12).toString("hex");
    const payload = { jsonrpc: "2.0", ...(!notification ? { id } : {}), method, params };
    if (notification) return this.send(payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MCP request timed out; the operation was not replayed"));
        this.close();
      }, this.manifest.timeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      Promise.resolve().then(() => this.send(payload)).catch((error) => {
        const pending = this.pending.get(id);
        if (pending) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    if (this.protocolVersion) return;
    this.initializing = (async () => {
      await this.open();
      const result = await this.rpc("initialize", { protocolVersion: supportedMCPVersions[0], capabilities: {},
        clientInfo: { name: "dia-custom", version: "0.2.0" } });
      if (!supportedMCPVersions.includes(result?.protocolVersion)) throw new Error("Unsupported MCP protocol version");
      this.protocolVersion = result.protocolVersion;
      await this.rpc("notifications/initialized", {}, { notification: true });
    })().catch((error) => { this.close(); throw error; }).finally(() => { this.initializing = null; });
    return this.initializing;
  }

  async request(method, params) { await this.initialize(); return this.rpc(method, params); }
  close() { this.closed = true; this.fail(new Error("Connector transport closed; reconnect in settings")); }
}
