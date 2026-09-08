import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleConnectorAPI } from "../src/connector-api.js";

async function fixture(t, { enabled = true } = {}) {
  const calls = [];
  const registry = Object.fromEntries(["addManifest", "removeManifest", "connect", "disconnect", "discoverTools"]
    .map((method) => [method, async (...args) => {
      calls.push({ method, args });
      if (method === "addManifest") return args[0];
      if (method === "discoverTools") return [{ name: "mcp__custom_sample__read" }];
      return { ok: true };
    }]));
  const server = createServer(async (request, response) => {
    const handled = await handleConnectorAPI(request, response, new URL(request.url, "http://localhost"), {
      registry,
      hasAdminToken: async (incoming) => incoming.headers["x-dia-custom-token"] === "test-token",
      isEnabled: () => enabled,
      readBody: async (incoming) => {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        return Buffer.concat(chunks);
      },
      jsonResponse: (outgoing, status, value) => {
        outgoing.writeHead(status, { "content-type": "application/json" });
        outgoing.end(JSON.stringify(value));
      },
    });
    if (!handled) { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (path, { body, authenticated = true, method = "POST" } = {}) => fetch(
    `http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(authenticated ? { "x-dia-custom-token": "test-token" } : {}) },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    },
  );
  return { calls, request };
}

test("connector management and discovery require administration authentication", async (t) => {
  const { calls, request } = await fixture(t);
  for (const [path, method] of [
    ["/api/apps/connectors", "POST"], ["/api/apps/connectors/sample", "DELETE"],
    ...["connect", "reconnect", "disconnect", "tools"].map((action) => [`/api/apps/connectors/sample/${action}`, "POST"]),
  ]) {
    const result = await request(path, { authenticated: false, method, body: { profileID: "Default" } });
    assert.equal(result.status, 403, path);
  }
  assert.equal(calls.length, 0);
});

test("saving is separate from connecting and tokens only reach explicit connection actions", async (t) => {
  const { calls, request } = await fixture(t);
  const manifest = { id: "sample", authentication: "bearer" };
  const saved = await request("/api/apps/connectors", { body: { manifest, profileID: " Work ", token: "ignored" } });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, connector: manifest });
  assert.deepEqual(calls, [{ method: "addManifest", args: [manifest, { profileID: "Work" }] }]);
  const connected = await request("/api/apps/connectors/sample/connect", { body: { profileID: "Work", token: "private-token", unexpected: "ignored" } });
  assert.equal(connected.status, 200);
  assert.deepEqual(calls.at(-1), { method: "connect", args: ["sample", { profileID: "Work", token: "private-token" }] });
});

test("tools, disconnect, and removal dispatch the intended scoped operations", async (t) => {
  const { calls, request } = await fixture(t);
  const discovery = await request("/api/apps/connectors/sample/tools", { body: { profileID: "Profile 1" } });
  assert.deepEqual(await discovery.json(), { tools: [{ name: "mcp__custom_sample__read" }] });
  await request("/api/apps/connectors/sample/disconnect", { body: { profileID: "Profile 1", token: "ignored" } });
  const removed = await request("/api/apps/connectors/sample", { method: "DELETE" });
  assert.deepEqual(await removed.json(), { ok: true });
  assert.deepEqual(calls, [
    { method: "discoverTools", args: ["sample", { profileID: "Profile 1", force: true }] },
    { method: "disconnect", args: ["sample", { profileID: "Profile 1" }] },
    { method: "removeManifest", args: ["sample"] },
  ]);
});

test("invalid input cannot silently fall back to the Default profile", async (t) => {
  const { calls, request } = await fixture(t);
  for (const profileID of [undefined, "", " ", "../../Work", "Work\\Private", "a".repeat(121)]) {
    const result = await request("/api/apps/connectors/sample/connect", { body: { profileID } });
    assert.equal(result.status, 400);
  }
  assert.equal((await request("/api/apps/connectors", { body: "null" })).status, 400);
  assert.equal((await request("/api/apps/connectors", { body: "{" })).status, 400);
  assert.equal((await request("/api/apps/connectors/%ZZ", { method: "DELETE" })).status, 400);
  assert.equal((await request("/api/apps/connectors/sample/tools", { method: "GET" })).status, 405);
  assert.equal(calls.length, 0);
});

test("disabled live connectors reject configuration and tool requests", async (t) => {
  const { calls, request } = await fixture(t, { enabled: false });
  for (const path of ["/api/apps/connectors", "/api/apps/connectors/sample/tools"]) {
    const result = await request(path, { body: { profileID: "Default" } });
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /disabled/);
  }
  assert.equal(calls.length, 0);
});
