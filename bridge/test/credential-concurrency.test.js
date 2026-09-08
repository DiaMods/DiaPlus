import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { CredentialStore } from "../src/credentials.js";
import { AppsStateStore } from "../src/apps-state.js";

test("concurrent cold credential writes and deletion survive a reload", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-credential-concurrency-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "credentials.json");
  const store = new CredentialStore(path);
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.setRecord(`connector.Profile%20${index}.fixture`, { accessToken: `fixture-${index}` })));
  const read = new CredentialStore(path);
  assert.equal(Object.keys((await read.load()).credentials).length, 20);
  await Promise.all([store.setRecord("connector.Default.fixture", { accessToken: "new" }), store.delete("connector.Default.fixture"), store.set("provider", "provider-key")]);
  const final = new CredentialStore(path);
  assert.equal(await final.getRecord("connector.Default.fixture"), null);
  assert.equal(await final.get({ id: "provider" }), "provider-key");
});

test("concurrent cold Apps state writes preserve every profile after restart", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-apps-concurrency-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "apps.json");
  const store = new AppsStateStore(path);
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.updateBridgeConnection(`Profile ${index}`, "fixture", { connected: true, executionReady: true })));
  const read = new AppsStateStore(path);
  for (let index = 0; index < 20; index++) assert.equal((await read.publicState(`Profile ${index}`)).bridgeConnections.fixture.connected, true);
});
