import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { AppsStateStore } from "../src/apps-state.js";
import { ConnectorRegistry, credentialRecordID, toolName, validateManifest } from "../src/connectors/registry.js";
import { CredentialStore } from "../src/credentials.js";

const manifest = { id: "fixture", displayName: "Fixture", endpoint: "http://127.0.0.1:9900/mcp", allowedDomains: ["127.0.0.1"], authentication: "none" };
async function fixture(t, handler = () => ({ tools: [{ name: "lookup", inputSchema: { type: "object" } }] })) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-connectors-lifecycle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const stateStore = new AppsStateStore(resolve(directory, "apps.json"));
  const credentialStore = new CredentialStore(resolve(directory, "credentials.json"));
  const registry = new ConnectorRegistry({
    stateStore, credentialStore, manifestDirectory: resolve(directory, "connectors"),
    sparkChecker: async () => {}, sparkRunner: async (_command, args) => `Spark fixture: ${args.join(" ")}`,
    fetchImplementation: async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push({ ...request, headers: init.headers });
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = request.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
        : await handler(request, init);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
    },
  });
  await registry.initialize();
  await registry.addManifest(manifest);
  return { registry, directory, credentialStore, requests };
}

test("saving is owner-only, takes effect without restart, and requires an explicit profile connection", async (t) => {
  const { registry, directory, requests } = await fixture(t);
  assert.deepEqual(await registry.definitions(), []);
  assert.equal(requests.length, 0);
  const row = (await registry.status()).find((row) => row.id === "fixture");
  assert.equal(row.connected, false);
  assert.equal(row.executionReady, false);
  assert.equal((await stat(resolve(directory, "connectors/fixture.json"))).mode & 0o777, 0o600);
  await registry.connect("fixture", { profileID: "Work" });
  assert.equal((await registry.definitions("Work")).length, 1);
  assert.deepEqual(await registry.definitions("Default"), []);
  await assert.rejects(registry.execute("mcp__custom_fixture__lookup", {}, { profileID: "Default" }), /disconnected/);
  await registry.disconnect("fixture", { profileID: "Work" });
  assert.deepEqual(await registry.definitions("Work"), []);
  await assert.rejects(registry.execute("mcp__custom_fixture__lookup", {}, { profileID: "Work" }), /disconnected/);
});

test("discovery and credentials remain isolated across profiles containing spaces and Unicode", async (t) => {
  const { registry, credentialStore } = await fixture(t, (_request, init) => ({ tools: [{ name: init.headers.authorization === "Bearer alpha" ? "work_lookup" : "home_lookup" }] }));
  await registry.addManifest({ ...manifest, authentication: "bearer" });
  await registry.connect("fixture", { profileID: "Work Profile – α", token: "alpha" });
  await registry.connect("fixture", { profileID: "Home Profile", token: "bravo" });
  assert.match((await registry.definitions("Work Profile – α"))[0].name, /work_lookup/);
  assert.match((await registry.definitions("Home Profile"))[0].name, /home_lookup/);
  assert.equal((await credentialStore.getRecord(credentialRecordID("Work Profile – α", "fixture"))).accessToken, "alpha");
  const reloaded = new CredentialStore(credentialStore.path);
  assert.equal((await reloaded.getRecord(credentialRecordID("Work Profile – α", "fixture"))).accessToken, "alpha");
  assert.doesNotMatch(JSON.stringify(await registry.status("Home Profile")), /bravo/);
});

test("MCP discovery follows pages and refresh replaces removed tools", async (t) => {
  let version = 1;
  const { registry } = await fixture(t, (request) => version === 2 ? { tools: [{ name: "replacement" }] }
    : request.params.cursor ? { tools: [{ name: "second" }] } : { tools: [{ name: "first" }], nextCursor: "page-2" });
  await registry.connect("fixture");
  assert.equal((await registry.definitions()).length, 2);
  version = 2;
  const refreshed = await registry.discoverTools("fixture", { force: true });
  assert.equal(refreshed.length, 1);
  assert.match(refreshed[0].name, /replacement/);
  assert.equal(registry.isTool("mcp__custom_fixture__first"), false);
});

test("repeated discovery cursors fail without leaving callable stale tools", async (t) => {
  const { registry } = await fixture(t, () => ({ tools: [{ name: "loop" }], nextCursor: "again" }));
  await assert.rejects(registry.connect("fixture"), /cursor/);
  assert.deepEqual(await registry.definitions(), []);
  assert.equal((await registry.status()).find((row) => row.id === "fixture").executionReady, false);
});

test("editing and removing manifests clear all profile credentials, tools and persisted configuration", async (t) => {
  const { registry, directory, credentialStore } = await fixture(t);
  await registry.addManifest({ ...manifest, authentication: "bearer" });
  await registry.connect("fixture", { profileID: "Work Profile", token: "secret" });
  await registry.addManifest({ ...manifest, endpoint: "http://127.0.0.1:9901/mcp", token: "must-not-persist" });
  assert.equal(await credentialStore.getRecord(credentialRecordID("Work Profile", "fixture")), null);
  assert.deepEqual(await registry.definitions("Work Profile"), []);
  assert.doesNotMatch(await readFile(resolve(directory, "connectors/fixture.json"), "utf8"), /must-not-persist/);
  await registry.removeManifest("fixture");
  assert.throws(() => registry.manifest("fixture"), /unknown/);
  await assert.rejects(stat(resolve(directory, "connectors/fixture.json")), { code: "ENOENT" });
  await assert.rejects(registry.removeManifest("gmail"), /Native/);
});

test("disconnected in-flight discovery cannot republish tools", async (t) => {
  let release;
  let entered;
  const entry = new Promise((resolve) => { entered = resolve; });
  const { registry } = await fixture(t, () => new Promise((resolve) => { release = resolve; entered(); }));
  const connection = registry.connect("fixture");
  await entry;
  await registry.disconnect("fixture");
  release({ tools: [{ name: "stale" }] });
  await assert.rejects(connection, /disconnected|changed/);
  assert.deepEqual(await registry.definitions(), []);
});

test("Spark preset executes only documented read tools through the same profile route", async (t) => {
  const { registry } = await fixture(t);
  await registry.addManifest({ id: "spark", transport: "spark-cli", command: "/usr/local/bin/spark" });
  await registry.connect("spark", { profileID: "Mail" });
  const tools = await registry.definitions("Mail");
  assert.equal(tools.length, 11);
  assert.equal((await registry.execute("mcp__custom_spark__accounts", {}, { profileID: "Mail" })).content[0].text, "Spark fixture: accounts");
  await assert.rejects(registry.execute("mcp__custom_spark__thread", { id: "--download-attachments" }, { profileID: "Mail" }), /Invalid/);
});

test("MCP application errors are failures in connector readiness", async (t) => {
  const { registry } = await fixture(t, (request) => request.method === "tools/list" ? { tools: [{ name: "lookup" }] } : { isError: true, content: [{ type: "text", text: "private error body" }] });
  await registry.connect("fixture");
  await assert.rejects(registry.execute("mcp__custom_fixture__lookup", {}), /tool error/);
  const row = (await registry.status()).find((row) => row.id === "fixture");
  assert.equal(row.executionReady, false);
  assert.equal(row.lastSuccess, null);
  assert.doesNotMatch(row.lastError, /private/);
});

test("connector validation rejects reserved identities and unsafe endpoints; tool names stay distinct and portable", () => {
  for (const value of [{ ...manifest, id: "gmail" }, { ...manifest, endpoint: "https://api.diabrowser.com", allowedDomains: ["api.diabrowser.com"] }, { ...manifest, endpoint: "http://example.com", allowedDomains: ["example.com"] }, { ...manifest, endpoint: "https://user:password@example.com", allowedDomains: ["example.com"] }]) assert.throws(() => validateManifest(value));
  assert.equal(validateManifest({ ...manifest, endpoint: "http://[::1]:9999/mcp", allowedDomains: ["[::1]"] }).endpoint, "http://[::1]:9999/mcp");
  const values = [toolName("my-id", "look.up"), toolName("my_id", "look_up"), toolName("my-id", "look_up"), toolName("a".repeat(120), "b".repeat(120))];
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.every((value) => /^[a-zA-Z0-9_-]{1,64}$/.test(value)));
});


test("ambiguous legacy dotted IDs cannot migrate or delete another profile's credential", async (t) => {
  const { registry, credentialStore } = await fixture(t);
  await registry.addManifest({ ...manifest, authentication: "bearer" });
  await registry.connect("fixture", { profileID: "Work", token: "work-secret" });
  await registry.addManifest({ ...manifest, id: "Work.fixture", authentication: "bearer" });
  const dotted = registry.manifest("Work.fixture");
  assert.equal(await registry.credentialRecord(dotted, "Default"), null);
  await registry.disconnect("Work.fixture");
  assert.equal((await credentialStore.getRecord(credentialRecordID("Work", "fixture"))).accessToken, "work-secret");
  await registry.removeManifest("Work.fixture");
  assert.equal((await credentialStore.getRecord(credentialRecordID("Work", "fixture"))).accessToken, "work-secret");
});
