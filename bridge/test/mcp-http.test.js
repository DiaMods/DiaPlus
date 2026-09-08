import assert from "node:assert/strict";
import test from "node:test";
import { MCPHTTPClient } from "../src/connectors/mcp-http.js";

const manifest = { endpoint: "http://127.0.0.1:9999/mcp", allowedDomains: ["127.0.0.1"], displayName: "Test", authentication: "none" };
const rpc = (request, result, headers = {}) => new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json", ...headers } });
const initialize = (request, headers) => rpc(request, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } }, headers);

test("MCP initializes once and sends negotiated protocol and session on subsequent requests", async () => {
  const methods = [];
  const client = new MCPHTTPClient(manifest, { fetchImplementation: async (_url, init) => {
    const request = JSON.parse(init.body);
    methods.push(request.method);
    assert.equal(init.redirect, "error");
    if (request.method === "initialize") return initialize(request, { "mcp-session-id": "session-1" });
    assert.equal(init.headers["Mcp-Session-Id"], "session-1");
    assert.equal(init.headers["MCP-Protocol-Version"], "2025-06-18");
    if (request.method === "notifications/initialized") {
      assert.equal(request.id, undefined);
      return new Response(null, { status: 202 });
    }
    return rpc(request, { tools: [] });
  } });
  await Promise.all([client.request("tools/list", {}), client.request("tools/list", {})]);
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "tools/list"]);
});

test("MCP SSE matches request IDs, accepts multiline events and cancels an open response stream", async () => {
  let cancelled = false;
  const client = new MCPHTTPClient(manifest, { fetchImplementation: async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "initialize") return initialize(request);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\n'));
        controller.enqueue(encoder.encode(`data: {"jsonrpc":"2.0",\r\ndata: "id":${JSON.stringify(request.id)},"result":{"tools":[]}}\r\n\r\n`));
      },
      cancel() { cancelled = true; },
    }), { headers: { "content-type": "text/event-stream" } });
  } });
  assert.deepEqual(await client.request("tools/list", {}), { tools: [] });
  assert.equal(cancelled, true);
});

test("expired MCP sessions recover discovery but never replay a tool call", async () => {
  const calls = [];
  let sessions = 0;
  let expires = true;
  const client = new MCPHTTPClient(manifest, { fetchImplementation: async (_url, init) => {
    const request = JSON.parse(init.body);
    calls.push(request.method);
    if (request.method === "initialize") return initialize(request, { "mcp-session-id": `session-${++sessions}` });
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (expires) { expires = false; return new Response(null, { status: 404 }); }
    return rpc(request, { tools: [] });
  } });
  await client.request("tools/list", {});
  assert.equal(sessions, 2);
  expires = true;
  await assert.rejects(client.request("tools/call", { name: "create" }), /404/);
  assert.equal(calls.filter((method) => method === "tools/call").length, 1);
});

test("MCP rejects mismatched IDs, errors, oversized results and unsupported versions", async () => {
  for (const [mode, expected] of [["wrong-id", /request ID/], ["rpc-error", /request failed/], ["oversize", /4 MiB/], ["version", /protocol version/]]) {
    const client = new MCPHTTPClient(manifest, { fetchImplementation: async (_url, init) => {
      const request = JSON.parse(init.body);
      if (mode === "version") return rpc(request, { protocolVersion: "1999-01-01" });
      if (request.method === "initialize") return initialize(request);
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (mode === "wrong-id") return rpc({ id: "wrong" }, {});
      if (mode === "rpc-error") return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -1, message: "secret" } }));
      return rpc(request, { content: "x".repeat(4 * 1024 * 1024) });
    } });
    await assert.rejects(client.request("tools/list", {}), expected);
  }
});
