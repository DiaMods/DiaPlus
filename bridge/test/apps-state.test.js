import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { AppsStateStore } from "../src/apps-state.js";

test("Morning Brief is locally entitled, profile-exclusive, and once daily", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-apps-"));
  let now = new Date(2026, 7, 27, 6, 30);
  const path = resolve(directory, "apps.json");
  const store = new AppsStateStore(path, { now: () => now });

  assert.equal((await store.publicState("Default")).advancedChat.enabled, true);
  assert.equal((await store.publicState("Default")).morningBrief.due, false);
  await store.setMorningBrief({ enabled: true, profileID: "Default" });
  assert.equal((await store.publicState("Default")).morningBrief.due, true);
  assert.equal((await store.publicState("Work")).morningBrief.enabled, false);

  await store.setMorningBrief({ enabled: false, profileID: "Work" });
  assert.equal(
    (await store.publicState("Default")).morningBrief.enabled,
    true,
    "disabling another profile must not disable the active profile",
  );

  await store.recordMorningBrief({ profileID: "Default", status: "running", runID: "run-1", stage: "starting" });
  await store.recordMorningBrief({ profileID: "Default", status: "running", runID: "run-1", stage: "researching" });
  assert.equal((await store.publicState("Default")).morningBrief.run.attempts, 1);
  assert.equal((await store.publicState("Default")).morningBrief.run.stage, "researching");
  assert.equal((await store.publicState("Default")).morningBrief.due, false);
  await store.recordMorningBrief({ profileID: "Default", status: "failed", runID: "run-1", diagnostics: ["Gmail unavailable"] });
  assert.equal((await store.publicState("Default")).morningBrief.available, true);
  assert.equal((await store.publicState("Default")).morningBrief.due, false);
  now = new Date(now.getTime() + 30 * 60_000 + 1);
  assert.equal((await store.publicState("Default")).morningBrief.due, false, "failed briefs do not automatically retry every 30 minutes");
  await store.recordMorningBrief({ profileID: "Default", status: "succeeded", runID: "run-1", stage: "ingested", reportID: "report-1" });
  assert.equal((await store.publicState("Default")).morningBrief.due, false);
  assert.equal((await store.publicState("Default")).morningBrief.lastSuccess.reportID, "report-1");
  await store.recordMorningBrief({ profileID: "Default", status: "failed", runID: "late-error" });
  assert.equal((await store.publicState("Default")).morningBrief.run.status, "succeeded");

  await store.setMorningBrief({ enabled: true, profileID: "Work" });
  assert.equal((await store.publicState("Default")).morningBrief.enabled, false);
  assert.equal((await store.publicState("Work")).morningBrief.enabled, true);
  assert.equal(
    (await store.publicState("Work")).morningBrief.due,
    true,
    "a successful run from another profile must not suppress this profile",
  );
  await store.recordMorningBrief({ profileID: "Work", status: "succeeded", runID: "work-run", reportID: "work-report" });
  await store.setMorningBrief({ enabled: true, profileID: "Default" });
  assert.equal((await store.publicState("Default")).morningBrief.lastSuccess.reportID, "report-1");
  assert.equal((await store.publicState("Work")).morningBrief.lastSuccess.reportID, "work-report");

  now = new Date(2026, 7, 28, 6, 0);
  await store.setMorningBrief({ enabled: true, profileID: "Work" });
  await store.recordMorningBrief({
    profileID: "Work",
    status: "failed",
    stage: "native-controller-incompatible",
  });
  assert.equal((await store.publicState("Work")).morningBrief.available, false);

  now = new Date(2026, 7, 29, 12, 0);
  await store.setMorningBrief({ enabled: true, profileID: "Default" });
  assert.equal((await store.publicState("Default")).morningBrief.due, false, "launching after the morning window does not generate a brief");
  const stat = await import("node:fs/promises").then(({ stat }) => stat(path));
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(JSON.parse(await readFile(path, "utf8")).morningBrief.enabledProfileID, "Default");
});

test("Morning Brief stays inside the morning window and survives restart without duplicate attempts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-brief-schedule-"));
  const path = resolve(directory, "apps.json");
  let now = new Date(2026, 8, 7, 4, 59);
  let store = new AppsStateStore(path, { now: () => now });
  await store.setMorningBrief({ enabled: true });
  assert.equal((await store.publicState()).morningBrief.due, false);
  now = new Date(2026, 8, 7, 5, 0);
  assert.equal((await store.publicState()).morningBrief.due, true);
  await store.recordMorningBrief({ status: 'running', stage: 'native-action-dispatched' });
  for (const hour of [6, 10, 11, 18, 23]) {
    now = new Date(2026, 8, 7, hour, 30);
    store = new AppsStateStore(path, { now: () => now });
    assert.equal((await store.publicState()).morningBrief.due, false, `no duplicate at ${hour}:30 after restart`);
  }
  now = new Date(2026, 8, 8, 4, 59);
  assert.equal((await store.publicState()).morningBrief.due, false);
  now = new Date(2026, 8, 8, 5, 0);
  assert.equal((await store.publicState()).morningBrief.due, true, 'eligible again the next morning');
  now = new Date(2026, 8, 8, 10, 59);
  assert.equal((await store.publicState()).morningBrief.due, true);
  now = new Date(2026, 8, 8, 11, 0);
  assert.equal((await store.publicState()).morningBrief.due, false, 'morning window ends at 11 AM');
});

test("native observations preserve only connection metadata", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-apps-"));
  const store = new AppsStateStore(resolve(directory, "apps.json"));
  await store.updateNativeState({
    profileID: "Default",
    connectors: [{
      id: "gmail",
      connected: true,
      autoConnected: true,
      accountLabel: "user@example.com",
      capabilities: ["search_email"],
      cookie: "must-not-persist",
    }],
  });
  const state = await store.publicState("Default");
  assert.equal(state.nativeConnections.gmail.connected, true);
  assert.equal("cookie" in state.nativeConnections.gmail, false);
});

test("bridge connector state is isolated per profile and migrates the legacy shape", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-apps-"));
  const path = resolve(directory, "apps.json");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, JSON.stringify({
    version: 1,
    bridgeConnections: { sample: { connected: true, accountLabel: "legacy@example.com" } },
  })));
  const store = new AppsStateStore(path);
  assert.equal((await store.publicState("Default")).bridgeConnections.sample.connected, true);
  assert.deepEqual((await store.publicState("Work")).bridgeConnections, {});
  await store.updateBridgeConnection("Work", "sample", {
    connected: true,
    authenticated: true,
    executionReady: true,
    lastSuccess: "2026-08-29T12:00:00.000Z",
  });
  assert.equal((await store.publicState("Work")).bridgeConnections.sample.executionReady, true);
  assert.equal((await store.publicState("Default")).bridgeConnections.sample.accountLabel, "legacy@example.com");
});

test("older Apps state without a profile remains disabled", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-apps-"));
  const path = resolve(directory, "apps.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, JSON.stringify({ version: 1, morningBrief: {} })));
  const store = new AppsStateStore(path);
  assert.equal((await store.publicState("Default")).morningBrief.enabled, false);
});
