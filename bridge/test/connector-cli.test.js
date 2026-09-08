import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateManifest, ConnectorRegistry, credentialRecordID } from "../src/connectors/registry.js";
import { cliArguments, executeCLI } from "../src/connectors/cli-adapter.js";
import { processEnvironment } from "../src/connectors/local-process.js";
import { AppsStateStore } from "../src/apps-state.js";
import { CredentialStore } from "../src/credentials.js";

const fixtureManifest = { id: "notes", transport: "cli", command: process.execPath, args: [], envKeys: ["DIA_FIXTURE_KEY"], tools: [{
  name: "lookup", description: "Look up notes", annotations: { readOnlyHint: true }, output: "json",
  inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 10 }, tags: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["query"] },
  args: ["lookup", { input: "query", flag: "--query" }, { input: "limit", flag: "--limit" }, { input: "tags", flag: "--tag" }],
}] };

test("generic CLI maps only schema-validated arguments to fixed templates", async () => {
  const manifest = validateManifest(fixtureManifest);
  assert.deepEqual(cliArguments(manifest, "lookup", { query: "$(touch /tmp/not-run)", limit: 2, tags: ["a", "b"] }), ["lookup", "--query", "$(touch /tmp/not-run)", "--limit", "2", "--tag", "a", "--tag", "b"]);
  for (const input of [{}, { query: "--help" }, { query: "a", limit: 11 }, { query: "a", args: ["--danger"] }, { query: "a", tags: [1] }]) assert.throws(() => cliArguments(manifest, "lookup", input));
  assert.throws(() => validateManifest({ ...fixtureManifest, command: "node" }), /absolute/);
  assert.throws(() => validateManifest({ ...fixtureManifest, envKeys: ["NODE_OPTIONS"] }), /forbidden/);
  assert.throws(() => processEnvironment(manifest, { OTHER_SECRET: "no" }), /envKeys/);
  const result = await executeCLI(manifest, "lookup", { query: "a" }, { runner: async () => '{"records":[{"id":"one"}]}' });
  assert.deepEqual(result.structuredContent.records, [{ id: "one" }]);
});

export async function registryFixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-cli-registry-"));
  const registry = new ConnectorRegistry({ stateStore: new AppsStateStore(resolve(directory, "state.json")), credentialStore: new CredentialStore(resolve(directory, "credentials.json")), manifestDirectory: resolve(directory, "connectors"), ...options });
  await registry.initialize();
  t.after(async () => { registry.close(); await rm(directory, { recursive: true, force: true }); });
  return { registry, directory };
}

test("CLI registration is immediate and environment credentials stay out of manifests and public status", async (t) => {
  const calls = [];
  const { registry, directory } = await registryFixture(t, { processRunner: async (manifest, args, options) => {
    calls.push({ command: manifest.command, args, environment: options.environment });
    return '{"records":[]}';
  } });
  await registry.addManifest({ ...fixtureManifest, env: { DIA_FIXTURE_KEY: "never-save" } });
  await registry.connect("notes", { profileID: "Work", environment: { DIA_FIXTURE_KEY: "local-secret" } });
  const definitions = await registry.definitions("Work");
  assert.equal(definitions.length, 1);
  await registry.execute(definitions[0].name, { query: "budget" }, { profileID: "Work" });
  assert.deepEqual(calls[0].environment, { DIA_FIXTURE_KEY: "local-secret" });
  assert.equal((await registry.definitions("Default")).length, 0);
  assert.doesNotMatch(await readFile(resolve(directory, "connectors/notes.json"), "utf8"), /local-secret|never-save/);
  assert.doesNotMatch(JSON.stringify(await registry.status("Work")), /local-secret/);
  await registry.disconnect("notes", { profileID: "Work" });
  assert.equal(await registry.credentialStore.getRecord(credentialRecordID("Work", "notes")), null);
});

test("incremental sync commits cursors only after profile-scoped indexing succeeds and uses the saved cursor", async (t) => {
  const imports = [];
  const calls = [];
  let shouldFail = false;
  const { registry } = await registryFixture(t, { processRunner: async (_manifest, args) => {
    calls.push(args);
    return JSON.stringify({ records: [{ id: "record-1", content: "Fixture" }], deletedIDs: ["old-record"], cursor: String(calls.length) });
  }, onSync: async (batch) => { if (shouldFail) throw new Error("index unavailable"); imports.push(batch); } });
  await registry.addManifest({ ...fixtureManifest, tools: [{ ...fixtureManifest.tools[0], name: "changes", inputSchema: { type: "object", properties: { cursor: { type: "string" } } }, args: ["changes", { input: "cursor", flag: "--cursor" }] }], sync: { tool: "changes" } });
  await registry.connect("notes", { profileID: "Work" });
  assert.equal((await registry.sync("notes", { profileID: "Work" })).cursor, "1");
  assert.equal(imports[0].profileID, "Work");
  shouldFail = true;
  await assert.rejects(registry.sync("notes", { profileID: "Work" }), /index unavailable/);
  assert.equal((await registry.stateStore.publicState("Work")).bridgeConnections.notes.syncCursor, "1");
  assert.deepEqual(calls[1], ["changes", "--cursor", "1"]);
  await assert.rejects(registry.sync("notes", { profileID: "Default" }), /disconnected/);
});
