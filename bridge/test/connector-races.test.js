import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { AppsStateStore } from "../src/apps-state.js";
import { CredentialStore } from "../src/credentials.js";
import { ConnectorRegistry, credentialRecordID } from "../src/connectors/registry.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const oauthManifest = {
  id: "sample", displayName: "Sample", authentication: "oauth",
  endpoint: "https://old.example.com/mcp", allowedDomains: ["example.com"],
  oauth: {
    authorizationURL: "https://old.example.com/authorize",
    tokenURL: "https://old.example.com/token", clientID: "fixture",
  },
};

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "fresh-token", refresh_token: "rotated-token", expires_in: 3600 }), {
    headers: { "content-type": "application/json" },
  });
}

async function fixture(context, { onToken, onList, manifest = oauthManifest, sparkChecker } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-connector-races-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stateStore = new AppsStateStore(resolve(directory, "apps.json"));
  const credentialStore = new CredentialStore(resolve(directory, "credentials.json"));
  await stateStore.load();
  await credentialStore.load();
  const requests = [];
  const registry = new ConnectorRegistry({
    stateStore, credentialStore, manifestDirectory: resolve(directory, "connectors"),
    ...(sparkChecker ? { sparkChecker } : {}),
    fetchImplementation: async (url, options) => {
      requests.push({ url: String(url), authorization: options.headers.authorization });
      if (new URL(url).pathname === "/token") return onToken ? onToken(options) : tokenResponse();
      const request = JSON.parse(options.body);
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (request.method === "tools/list" && onList) await onList();
      const result = request.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
        : { tools: [{ name: "lookup", inputSchema: { type: "object" } }] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  await registry.addManifest(manifest);
  return { registry, credentialStore, stateStore, requests };
}

for (const action of ["disconnect", "edit", "remove"]) {
  test(`an OAuth exchange completing after ${action} cannot restore credentials or contact the new endpoint`, async (context) => {
    const started = deferred();
    const response = deferred();
    const { registry, credentialStore, stateStore, requests } = await fixture(context, {
      onToken: () => { started.resolve(); return response.promise; },
    });
    const authorization = await registry.connect("sample", { profileID: "Work" });
    const state = new URL(authorization.authorizationURL).searchParams.get("state");
    const rejected = assert.rejects(registry.completeOAuth({ state, code: "fixture-code" }), /Connector changed/);
    await started.promise;
    if (action === "disconnect") await registry.disconnect("sample", { profileID: "Work" });
    else if (action === "remove") await registry.removeManifest("sample");
    else await registry.addManifest({ ...oauthManifest, endpoint: "https://new.example.com/mcp" });
    response.resolve(tokenResponse());
    await rejected;
    assert.equal(await credentialStore.getRecord(credentialRecordID("Work", "sample")), null);
    assert.notEqual((await stateStore.publicState("Work")).bridgeConnections.sample?.connected, true);
    assert.equal(registry.profileTools("sample", "Work").length, 0);
    assert.ok(requests.every((request) => request.url === "https://old.example.com/token"));
  });
}

test("simultaneous OAuth refreshes share one rotation and keep existing tool definitions", async (context) => {
  const started = deferred();
  const response = deferred();
  let rotations = 0;
  const { registry, credentialStore, stateStore } = await fixture(context, {
    onToken: () => { rotations += 1; started.resolve(); return response.promise; },
  });
  const manifest = registry.manifest("sample");
  const id = credentialRecordID("Work", "sample");
  await credentialStore.setRecord(id, { accessToken: "previous-token", refreshToken: "previous-refresh", expiresAt: 1 });
  await stateStore.updateBridgeConnection("Work", "sample", { connected: true, executionReady: true });
  registry.toolMap.set(registry.profileKey("existing", "Work"), {
    connectorID: "sample", profileID: "Work", definition: { name: "existing" },
  });
  const pending = Array.from({ length: 10 }, () => registry.accessToken(manifest, { profileID: "Work" }));
  await started.promise;
  response.resolve(tokenResponse());
  assert.deepEqual(await Promise.all(pending), Array(10).fill("fresh-token"));
  assert.equal(rotations, 1);
  assert.equal((await credentialStore.getRecord(id)).refreshToken, "rotated-token");
  assert.equal(registry.profileTools("sample", "Work").length, 1);
  assert.equal(registry.refreshes.size, 0);
});

for (const action of ["disconnect", "edit", "remove"]) {
  test(`a token refresh completing after ${action} cannot restore old authorization`, async (context) => {
    const started = deferred();
    const response = deferred();
    const { registry, credentialStore, stateStore } = await fixture(context, {
      onToken: () => { started.resolve(); return response.promise; },
    });
    const id = credentialRecordID("Work", "sample");
    await credentialStore.setRecord(id, { accessToken: "previous-token", refreshToken: "previous-refresh", expiresAt: 1 });
    await stateStore.updateBridgeConnection("Work", "sample", { connected: true });
    const rejected = assert.rejects(registry.accessToken(registry.manifest("sample"), { profileID: "Work" }), /Connector changed/);
    await started.promise;
    if (action === "disconnect") await registry.disconnect("sample", { profileID: "Work" });
    else if (action === "remove") await registry.removeManifest("sample");
    else await registry.addManifest({ ...oauthManifest, endpoint: "https://new.example.com/mcp" });
    response.resolve(tokenResponse());
    await rejected;
    assert.equal(await credentialStore.getRecord(id), null);
    assert.notEqual((await stateStore.publicState("Work")).bridgeConnections.sample?.connected, true);
    assert.equal(registry.refreshes.size, 0);
  });
}

test("late Spark connect completion cannot overwrite a later disconnect", async (context) => {
  const started = deferred();
  const check = deferred();
  const { registry, stateStore } = await fixture(context, {
    manifest: { id: "sample", transport: "spark-cli", command: "/usr/local/bin/spark" },
    sparkChecker: () => { started.resolve(); return check.promise; },
  });
  const rejected = assert.rejects(registry.connect("sample", { profileID: "Work" }), /Connector changed/);
  await started.promise;
  await registry.disconnect("sample", { profileID: "Work" });
  check.resolve();
  await rejected;
  const connection = (await stateStore.publicState("Work")).bridgeConnections.sample;
  assert.equal(connection.connected, false);
  assert.equal(connection.executionReady, false);
  assert.equal(connection.lastError, null);
  assert.equal(registry.profileTools("sample", "Work").length, 0);
});

test("dotted profile and connector names have distinct credential keys without ambiguous migration", async (context) => {
  const first = credentialRecordID("Work.team", "mail");
  const second = credentialRecordID("Work", "team.mail");
  assert.notEqual(first, second);
  assert.equal(first, "connector.Work%2Eteam.mail");
  assert.equal(credentialRecordID("Default", "mail"), "connector.Default.mail");
  const { registry, credentialStore } = await fixture(context, { manifest: { ...oauthManifest, id: "mail" } });
  await credentialStore.setRecord("connector.Work.team.mail", { accessToken: "ambiguous-old-token" });
  assert.equal(await registry.credentialRecord(registry.manifest("mail"), "Work.team"), null);
  assert.equal((await credentialStore.getRecord("connector.Work.team.mail")).accessToken, "ambiguous-old-token");
});

test("custom mail and calendar tool results cannot authenticate Dia's native connectors", async (context) => {
  const { registry, stateStore } = await fixture(context);
  await registry.observeNativeToolResults("Work", { messages: [
    { role: "assistant", content: [
      { type: "tool_use", id: "email", name: "mcp__custom_spark__emails", input: {} },
      { type: "tool_use", id: "calendar", name: "mcp__custom_sample__read_google_calendar", input: {} },
    ] },
    { role: "user", content: [
      { type: "tool_result", tool_use_id: "email", content: "Found mail" },
      { type: "tool_result", tool_use_id: "calendar", content: "Found events" },
    ] },
  ] });
  assert.deepEqual((await stateStore.publicState("Work")).nativeConnections, {});
});

test("native declared capabilities do not imply observed schemas or execution readiness", async (context) => {
  const { registry, stateStore } = await fixture(context);
  const initial = (await registry.status("Work")).find((item) => item.id === "gmail");
  assert.ok(initial.capabilities.length > 0);
  assert.equal(initial.schemaAvailable, false);
  assert.equal(initial.executionReady, false);
  await stateStore.updateNativeConnection("Work", "gmail", { connected: true, executionReady: false });
  await registry.observeNativeTools("Work", [{ name: "mcp__dia-tools__search_gmail" }]);
  const advertised = (await registry.status("Work")).find((item) => item.id === "gmail");
  assert.equal(advertised.connected, true);
  assert.equal(advertised.schemaAvailable, true);
  assert.equal(advertised.executionReady, false);
  await registry.observeNativeToolResults("Work", { messages: [
    { role: "assistant", content: [{ type: "tool_use", id: "mail", name: "mcp__dia-tools__search_gmail", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "mail", content: '{"results":[{"subject":"Server error troubleshooting"}]}' }] },
  ] });
  assert.equal((await registry.status("Work")).find((item) => item.id === "gmail").executionReady, true);
});
