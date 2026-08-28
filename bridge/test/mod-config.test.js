import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { ModConfigStore } from "../src/mod-config.js";

async function fixture(activeModIDs = ["safety", "feature"]) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-mods-"));
  const manifestPath = resolve(directory, "dia-mods.json");
  const statePath = resolve(directory, "mods.json");
  const legacyStatePath = resolve(directory, "modules.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    mods: [
      {
        id: "safety", label: "Safety", description: "Required",
        scope: ["runtime"], defaultEnabled: true, required: true,
        rebuildOnChange: false,
      },
      {
        id: "feature", label: "Feature", description: "Optional",
        scope: ["runtime"], defaultEnabled: true, required: false,
        rebuildOnChange: false,
      },
      {
        id: "patch", label: "Patch", description: "Build mod",
        scope: ["build"], defaultEnabled: false, required: false,
        rebuildOnChange: true,
      },
      {
        id: "account-bypass", label: "Anonymous", description: "No account",
        scope: ["build"], defaultEnabled: true, required: false,
        rebuildOnChange: true,
      },
      {
        id: "official-dia-sync", label: "Official Sync", description: "Sync",
        scope: ["build"], defaultEnabled: false, required: false,
        rebuildOnChange: true, requires: ["safety"],
        conflicts: ["account-bypass"], replaces: ["account-bypass"],
      },
    ],
  }));
  return {
    directory,
    statePath,
    legacyStatePath,
    store: new ModConfigStore({
      manifestPath, statePath, legacyStatePath, activeModIDs,
    }),
  };
}

test("Dia Mods keep safety mods locked and mark restart/rebuild changes", async () => {
  const { statePath, store } = await fixture();
  await assert.rejects(() => store.setEnabled("safety", false), /required safety\/core/);

  let state = await store.setEnabled("feature", false);
  assert.equal(state.restartRequired, true);
  assert.equal(state.mods.find((mod) => mod.id === "feature").pending, true);

  state = await store.setEnabled("patch", true);
  assert.equal(state.rebuildRequired, true);
  assert.equal(state.mods.find((mod) => mod.id === "patch").apply, "rebuild");
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
});

test("Official Sync atomically replaces and restores anonymous account mode", async () => {
  const { store } = await fixture();
  let state = await store.setEnabled("official-dia-sync", true);
  assert.equal(state.mods.find((mod) => mod.id === "official-dia-sync").configuredEnabled, true);
  assert.equal(state.mods.find((mod) => mod.id === "account-bypass").configuredEnabled, false);
  assert.equal(state.rebuildRequired, true);

  state = await store.setEnabled("official-dia-sync", false);
  assert.equal(state.mods.find((mod) => mod.id === "official-dia-sync").configuredEnabled, false);
  assert.equal(state.mods.find((mod) => mod.id === "account-bypass").configuredEnabled, true);
});

test("Dia Mods read legacy module overrides until new state is saved", async () => {
  const { legacyStatePath, statePath, store } = await fixture(["safety"]);
  await writeFile(legacyStatePath, JSON.stringify({
    version: 1, overrides: { feature: false },
  }));

  const migrated = await store.publicState();
  assert.equal(migrated.mods.find((mod) => mod.id === "feature").configuredEnabled, false);
  await store.setEnabled("feature", true);
  const saved = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(saved.overrides.feature, true);
});
