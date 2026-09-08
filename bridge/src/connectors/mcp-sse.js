import { assertAllowedConnectorURL } from "../network-policy.js";
import { PersistentMCPClient, maximumMCPMessageBytes } from "./mcp-rpc.js";

export class MCPSSEClient extends PersistentMCPClient {
  constructor(manifest, { fetchImplementation = fetch, accessToken = async () => null } = {}) {
    super(manifest);
    this.fetch = fetchImplementation;
    this.accessToken = accessToken;
    this.abort = new AbortController();
    this.endpoint = null;
  }

  async headers() {
    const token = await this.accessToken();
    if (this.manifest.authentication !== "none" && !token) throw new Error("Connector authorization is missing; reconnect in settings");
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async open() {
    const timer = setTimeout(() => this.abort.abort(), this.manifest.timeoutMs ?? 30_000);
    try {
      const response = await this.fetch(assertAllowedConnectorURL(this.manifest.endpoint, this.manifest.allowedDomains), {
        method: "GET", redirect: "error", headers: { accept: "text/event-stream", ...await this.headers() }, signal: this.abort.signal,
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`MCP SSE connection failed (HTTP ${response.status})`);
      }
      await new Promise((resolve, reject) => {
        void this.readEvents(response.body, resolve).catch((error) => { reject(error); this.fail(error); this.close(); });
      });
    } finally { clearTimeout(timer); }
  }

  async readEvents(body, ready) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) throw new Error("MCP SSE stream closed; reconnect in settings");
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (Buffer.byteLength(event) > maximumMCPMessageBytes) throw new Error("MCP SSE event exceeds 4 MiB");
          const lines = event.split(/\r?\n/);
          const type = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
          const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
          if (type === "endpoint" && data) {
            if (this.endpoint) throw new Error("MCP SSE endpoint changed during a session");
            const endpoint = assertAllowedConnectorURL(new URL(data, this.manifest.endpoint).toString(), this.manifest.allowedDomains);
            if (endpoint.origin !== new URL(this.manifest.endpoint).origin) throw new Error("MCP SSE message endpoint must have the server's origin");
            this.endpoint = endpoint.toString();
            ready();
          } else if (type === "message" && data) this.receive(JSON.parse(data));
        }
        if (Buffer.byteLength(buffer) > maximumMCPMessageBytes) throw new Error("MCP SSE event exceeds 4 MiB");
      }
    } finally { await reader.cancel().catch(() => {}); }
  }

  async send(payload) {
    if (!this.endpoint || this.closed) throw new Error("MCP SSE connection is closed");
    const response = await this.fetch(this.endpoint, {
      method: "POST", redirect: "error", headers: { "content-type": "application/json", ...await this.headers() },
      body: JSON.stringify(payload), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.manifest.timeoutMs ?? 30_000)]),
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) throw new Error(`MCP SSE request returned HTTP ${response.status}; it was not replayed`);
  }

  close() { this.abort.abort(); super.close(); }
}
