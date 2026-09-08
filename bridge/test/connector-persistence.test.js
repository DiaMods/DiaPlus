import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { AppsStateStore } from "../src/apps-state.js";
import { CredentialStore } from "../src/credentials.js";
import { ConnectorRegistry, credentialRecordID } from "../src/connectors/registry.js";

const httpManifest = { id: "sample", endpoint: "http://127.0.0.1:9988/mcp", allowedDomains: ["127.0.0.1"], authentication: "none" };
const sparkManifest = { id: "spark", transport: "spark-cli", command: "/usr/local/bin/spark" };
const oauthManifest = { ...httpManifest, authentication: "oauth", oauth: {
  authorizationURL: "http://127.0.0.1:9988/authorize", tokenURL: "http://127.0.0.1:9988/token", clientID: "fixture",
} };

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-connectors-persistence-"));
  const registries = [];
  const requests = [];
  let now = 1_800_000_000_000;
  t.after(async () => { for (const registry of registries) registry.close(); await rm(directory, { recursive: true, force: true }); });
  async function create({ onRequest, sparkChecker = async () => ({ version: "1.3.1" }), ...options } = {}) {
    const registry = new ConnectorRegistry({
      stateStore: new AppsStateStore(resolve(directory, "apps.json")),
      credentialStore: new CredentialStore(resolve(directory, "credentials.json")),
      manifestDirectory: resolve(directory, "connectors"), now: () => now, sparkChecker,
      fetchImplementation: async (url, init) => {
        if (String(url).endsWith("/token")) {
          requests.push({ method: "token", grant: new URLSearchParams(init.body).get("grant_type") });
          const response = await onRequest?.({ method: "token" }, init);
          return response ?? new Response(JSON.stringify({ access_token: "refreshed", refresh_token: "rotated", expires_in: 3600 }), { headers: { "content-type": "application/json" } });
        }
        const rpc = JSON.parse(init.body);
        requests.push({ ...rpc, authorization: init.headers.authorization });
        const response = await onRequest?.(rpc, init);
        if (response) return response;
        if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
        const result = rpc.method === "initialize" ? { protocolVersion: "2025-06-18" } : { tools: [{ name: "lookup", inputSchema: { type: "object" } }] };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), { headers: { "content-type": "application/json" } });
      }, ...options,
    });
    registries.push(registry);
    await registry.initialize();
    return registry;
  }
  return { create, directory, requests, advance: () => { now += 30_001; } };
}

test("Spark connection intent survives a complete state/registry reload, rechecks Desktop, and disconnect persists", async (t) => {
  const { create, directory } = await fixture(t);
  const original = await create();
  await original.addManifest(sparkManifest);
  await original.connect("spark", { profileID: "Work – α" });
  original.close();
  const started = deferred();
  const check = deferred();
  let checks = 0;
  const restarted = await create({ sparkChecker: async () => { checks += 1; started.resolve(); await check.promise; return { version: "1.3.1" }; } });
  await started.promise;
  const restoring = (await restarted.status("Work – α")).find((row) => row.id === "spark");
  assert.equal(restoring.desiredConnected, true);
  assert.equal(restoring.connectionState, "connecting");
  assert.equal(restoring.executionReady, false);
  assert.equal(restoring.schemaAvailable, false);
  check.resolve();
  await restarted.restoring;
  assert.equal(checks, 1);
  assert.ok((await restarted.definitions("Work – α")).some((tool) => tool.name.endsWith("__draft")));
  assert.deepEqual(await restarted.definitions("Default"), []);
  assert.equal((await restarted.status("Work – α")).find((row) => row.id === "spark").connectionState, "connected");
  await restarted.disconnect("spark", { profileID: "Work – α" });
  assert.equal(JSON.parse(await readFile(resolve(directory, "apps.json"), "utf8")).bridgeConnections["Work – α"].spark.desiredConnected, false);
  restarted.close();
  const disconnected = await create({ sparkChecker: async () => { throw new Error("Explicit disconnect must not reopen Spark"); } });
  await disconnected.restoring;
  assert.deepEqual(await disconnected.definitions("Work – α"), []);
  assert.equal((await disconnected.status("Work – α")).find((row) => row.id === "spark").connectionState, "disconnected");
});

test("HTTP reconnect reuses only the selected profile's persisted bearer credential and ignores disconnected credentials", async (t) => {
  const { create, requests } = await fixture(t);
  const original = await create();
  await original.addManifest({ ...httpManifest, authentication: "bearer" });
  await original.connect("sample", { profileID: "Work", token: "work-token" });
  await original.connect("sample", { profileID: "Home", token: "home-token" });
  await original.disconnect("sample", { profileID: "Home" });
  // A leftover credential alone is never permission to reconnect a profile.
  await original.credentialStore.setRecord(credentialRecordID("Home", "sample"), { accessToken: "orphaned-token" });
  original.close();
  requests.length = 0;
  const restarted = await create();
  await restarted.restoring;
  assert.equal((await restarted.definitions("Work")).length, 1);
  assert.deepEqual(await restarted.definitions("Home"), []);
  assert.equal(requests.filter((request) => request.method === "initialize").length, 1);
  assert.ok(requests.every((request) => request.authorization === "Bearer work-token"));
});

test("temporary startup failures retain intent, use a retry delay, and recover without another Connect", async (t) => {
  const { create, requests, advance } = await fixture(t);
  const original = await create();
  await original.addManifest(httpManifest);
  await original.connect("sample");
  original.close();
  let available = false;
  const restarted = await create({ onRequest: () => available ? undefined : new Response(null, { status: 503 }) });
  await restarted.restoring;
  let row = (await restarted.status()).find((item) => item.id === "sample");
  assert.equal(row.desiredConnected, true);
  assert.equal(row.connected, false);
  assert.equal(row.connectionState, "error");
  const failedCount = requests.length;
  assert.deepEqual(await restarted.definitions(), []);
  assert.equal(requests.length, failedCount);
  available = true;
  advance();
  await restarted.reconcileConnections();
  row = (await restarted.status()).find((item) => item.id === "sample");
  assert.equal(row.connectionState, "connected");
  assert.equal(row.executionReady, true);
  assert.equal((await restarted.definitions()).length, 1);
});

test("a failed initial Connect also preserves restart intent", async (t) => {
  const { create } = await fixture(t);
  const original = await create({ onRequest: () => new Response(null, { status: 503 }) });
  await original.addManifest(httpManifest);
  await assert.rejects(original.connect("sample"), /503/);
  original.close();
  const restarted = await create();
  await restarted.restoring;
  assert.equal((await restarted.status()).find((row) => row.id === "sample").connectionState, "connected");
});

test("OAuth restart refreshes expired tokens once without beginning an authorization flow", async (t) => {
  const { create, requests } = await fixture(t);
  const original = await create();
  await original.addManifest(oauthManifest);
  const authorization = await original.connect("sample", { profileID: "Work" });
  await original.completeOAuth({ state: new URL(authorization.authorizationURL).searchParams.get("state"), code: "fixture" });
  const key = credentialRecordID("Work", "sample");
  const credential = await original.credentialStore.getRecord(key);
  await original.credentialStore.setRecord(key, { ...credential, expiresAt: 1 });
  original.close();
  requests.length = 0;
  const restarted = await create();
  await Promise.all([restarted.restoring, restarted.reconcileConnections(), restarted.definitions("Work")]);
  assert.deepEqual(requests.filter((item) => item.method === "token"), [{ method: "token", grant: "refresh_token" }]);
  assert.equal(restarted.oauthStates.size, 0);
  assert.equal((await restarted.status("Work")).find((row) => row.id === "sample").connectionState, "connected");
});

test("missing and rejected credentials require authorization while retaining intent and never reopening OAuth automatically", async (t) => {
  const { create, requests, advance } = await fixture(t);
  const original = await create();
  await original.addManifest({ ...httpManifest, authentication: "bearer" });
  await original.connect("sample", { token: "old" });
  await original.credentialStore.delete(credentialRecordID("Default", "sample"));
  original.close();
  requests.length = 0;
  const missing = await create();
  await missing.restoring;
  let row = (await missing.status()).find((item) => item.id === "sample");
  assert.equal(row.desiredConnected, true);
  assert.equal(row.connectionState, "auth-required");
  assert.equal(row.authenticated, false);
  assert.deepEqual(requests, []);
  await missing.credentialStore.setRecord(credentialRecordID("Default", "sample"), { accessToken: "expired" });
  missing.close();
  const rejected = await create({ onRequest: () => new Response(null, { status: 401 }) });
  await rejected.restoring;
  row = (await rejected.status()).find((item) => item.id === "sample");
  assert.equal(row.connectionState, "auth-required");
  assert.equal(row.authenticated, false);
  advance();
  const count = requests.length;
  await rejected.reconcileConnections();
  assert.equal(requests.length, count);
});

for (const action of ["disconnect", "edit", "remove", "close"]) {
  test(`a startup restoration completing after ${action} cannot restore readiness or intent`, async (t) => {
    const { create } = await fixture(t);
    const original = await create();
    await original.addManifest(sparkManifest);
    await original.connect("spark", { profileID: "Work" });
    original.close();
    const started = deferred();
    const check = deferred();
    const restarted = await create({ sparkChecker: async () => { started.resolve(); return check.promise; } });
    await started.promise;
    if (action === "disconnect") await restarted.disconnect("spark", { profileID: "Work" });
    else if (action === "edit") await restarted.addManifest({ ...sparkManifest, command: "/new/path/spark" });
    else if (action === "remove") await restarted.removeManifest("spark");
    else restarted.close();
    check.resolve({ version: "1.3.1" });
    await restarted.restoring;
    const row = (await restarted.stateStore.publicState("Work")).bridgeConnections.spark;
    assert.equal(row.executionReady, false);
    assert.equal(row.desiredConnected, action === "close");
    assert.equal(restarted.profileTools("spark", "Work").length, 0);
  });
}

test("legacy connected rows migrate to reconnect intent without enabling legacy disconnected rows", async (t) => {
  const { create, directory } = await fixture(t);
  const original = await create();
  await original.addManifest(httpManifest);
  await original.addManifest({ ...httpManifest, id: "off" });
  original.close();
  await writeFile(resolve(directory, "apps.json"), JSON.stringify({ version: 1,
    bridgeConnections: { sample: { connected: true, executionReady: true }, off: { connected: false } },
  }));
  const migrated = await create();
  await migrated.restoring;
  assert.equal((await migrated.status()).find((row) => row.id === "sample").desiredConnected, true);
  assert.equal((await migrated.status()).find((row) => row.id === "off").desiredConnected, false);
  assert.equal((await migrated.definitions()).length, 1);
});

test("stdio restarts its process with persisted profile environment credentials", async (t) => {
  const { create, directory } = await fixture(t);
  const script = resolve(directory, "mcp.cjs");
  await writeFile(script, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const r=JSON.parse(line);if(!r.id)return;
    const result=r.method==='initialize'?{protocolVersion:'2024-11-05'}:{tools:[{name:process.env.DIA_FIXTURE_TOKEN,inputSchema:{type:'object'}}]};
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
  });`);
  const original = await create();
  await original.addManifest({ id: "local", transport: "stdio", command: process.execPath, args: [script], envKeys: ["DIA_FIXTURE_TOKEN"] });
  await original.connect("local", { profileID: "Work", environment: { DIA_FIXTURE_TOKEN: "work_lookup" } });
  original.close();
  const restarted = await create();
  await restarted.restoring;
  assert.equal((await restarted.definitions("Work"))[0].name, "mcp__custom_local__work_lookup");
  assert.deepEqual(await restarted.definitions("Default"), []);
  assert.doesNotMatch(JSON.stringify(await restarted.status("Work")), /DIA_FIXTURE_TOKEN.*work_lookup/);
});
