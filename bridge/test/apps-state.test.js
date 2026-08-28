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

  await store.recordMorningBrief({ profileID: "Default", status: "running" });
  assert.equal((await store.publicState("Default")).morningBrief.due, false);
  await store.recordMorningBrief({ profileID: "Default", status: "failed", diagnostics: ["Gmail unavailable"] });
  assert.equal((await store.publicState("Default")).morningBrief.due, true);
  await store.recordMorningBrief({ profileID: "Default", status: "succeeded" });
  assert.equal((await store.publicState("Default")).morningBrief.due, false);

  await store.setMorningBrief({ enabled: true, profileID: "Work" });
  assert.equal((await store.publicState("Default")).morningBrief.enabled, false);
  assert.equal((await store.publicState("Work")).morningBrief.enabled, true);
  assert.equal(
    (await store.publicState("Work")).morningBrief.due,
    true,
    "a successful run from another profile must not suppress this profile",
  );
  await store.setMorningBrief({ enabled: true, profileID: "Default" });

  now = new Date(2026, 7, 28, 12, 0);
  assert.equal((await store.publicState("Default")).morningBrief.due, true, "launch catch-up remains due after 11 AM");
  const stat = await import("node:fs/promises").then(({ stat }) => stat(path));
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(JSON.parse(await readFile(path, "utf8")).morningBrief.enabledProfileID, "Default");
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

test("older Apps state without a profile remains disabled", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-apps-"));
  const path = resolve(directory, "apps.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, JSON.stringify({ version: 1, morningBrief: {} })));
  const store = new AppsStateStore(path);
  assert.equal((await store.publicState("Default")).morningBrief.enabled, false);
});
