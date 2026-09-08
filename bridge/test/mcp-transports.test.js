import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { MCPStdioClient } from "../src/connectors/mcp-stdio.js";
import { MCPSSEClient } from "../src/connectors/mcp-sse.js";

async function stdio(t, extra = "", timeoutMs = 2000) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-stdio-"));
  const file = resolve(directory, "fixture.cjs");
  await writeFile(file, `const readline = require('node:readline');
    const input = readline.createInterface({input: process.stdin});
    input.on('line', line => { const request = JSON.parse(line); ${extra}
      if (!request.id) return;
      const result = request.method === 'initialize' ? {protocolVersion:'2024-11-05'}
        : request.method === 'tools/list' ? {tools:[{name:'echo',inputSchema:{type:'object'}}]}
          : {content:[{type:'text',text:JSON.stringify({input:request.params.arguments, secret:process.env.DIA_FIXTURE_TOKEN, unexpected:process.env.DIA_FIXTURE_OTHER})}]};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
    });`);
  const client = new MCPStdioClient({ command: process.execPath, args: [file], envKeys: ["DIA_FIXTURE_TOKEN"], timeoutMs }, {
    environment: async () => ({ DIA_FIXTURE_TOKEN: "profile-local" }),
  });
  t.after(async () => { client.close(); await rm(directory, { recursive: true, force: true }); });
  return client;
}

test("stdio MCP performs the handshake, correlates concurrent replies and scopes environment", async (t) => {
  process.env.DIA_FIXTURE_OTHER = "provider-secret";
  t.after(() => { delete process.env.DIA_FIXTURE_OTHER; });
  const client = await stdio(t);
  assert.equal((await client.request("tools/list", {})).tools[0].name, "echo");
  const results = await Promise.all([1, 2].map((id) => client.request("tools/call", { name: "echo", arguments: { id, text: "$(touch /tmp/never-executed)" } })));
  assert.deepEqual(results.map((result) => JSON.parse(result.content[0].text)), [1, 2].map((id) => ({
    input: { id, text: "$(touch /tmp/never-executed)" }, secret: "profile-local",
  })));
  const child = client.child;
  client.close();
  await new Promise((resolve) => child.once("exit", resolve));
  await assert.rejects(client.request("tools/list", {}), /closed/);
});

test("stdio MCP times out hung calls, kills the process and never replays calls", async (t) => {
  const client = await stdio(t, "if (request.method === 'tools/call') return;", 100);
  await client.request("tools/list", {});
  await assert.rejects(client.request("tools/call", { name: "write" }), /timed out/);
  assert.equal(client.closed, true);
});

test("stdio rejects non-JSON stdout and oversized messages", async (t) => {
  for (const extra of ["process.stdout.write('debug-not-json\\n'); return;", "process.stdout.write('x'.repeat(4*1024*1024+1)); return;"]) {
    const client = await stdio(t, extra);
    await assert.rejects(client.request("tools/list", {}), /newline-delimited JSON|4 MiB/);
  }
});

async function sseFixture(t, endpoint = "/messages?session=fixture") {
  let stream;
  const calls = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      stream = response;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: endpoint\ndata: ${endpoint}\n\n`);
      return;
    }
    assert.equal(request.url, endpoint);
    assert.equal(request.headers.authorization, "Bearer local-secret");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rpc = JSON.parse(Buffer.concat(chunks));
    calls.push(rpc.method);
    response.writeHead(202); response.end();
    if (rpc.id) {
      const result = rpc.method === "initialize" ? { protocolVersion: "2024-11-05" }
        : rpc.method === "tools/list" ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { content: [{ type: "text", text: JSON.stringify(rpc.params.arguments) }] };
      stream.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new MCPSSEClient({ endpoint: `http://127.0.0.1:${server.address().port}/sse`, allowedDomains: ["127.0.0.1"], authentication: "bearer", timeoutMs: 1000 }, { accessToken: async () => "local-secret" });
  t.after(async () => { client.close(); stream?.end(); await new Promise((resolve) => server.close(resolve)); });
  return { client, calls };
}

test("legacy HTTP+SSE discovers its POST endpoint and receives correlated replies on the persistent GET", async (t) => {
  const { client, calls } = await sseFixture(t);
  assert.equal((await client.request("tools/list", {})).tools[0].name, "echo");
  assert.equal((await client.request("tools/call", { name: "echo", arguments: { answer: 42 } })).content[0].text, '{"answer":42}');
  assert.deepEqual(calls, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
});

test("legacy SSE refuses a cross-origin POST endpoint before forwarding credentials", async (t) => {
  const { client, calls } = await sseFixture(t, "http://127.0.0.1:1/messages");
  await assert.rejects(client.request("tools/list", {}), /origin/);
  assert.deepEqual(calls, []);
});
