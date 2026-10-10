import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

test("Local Memory keeps its legacy ID and enabled/disabled preference without a native pane", async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'dia-memory-preferences-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = new URL('../config/dia-mods.json', import.meta.url);
  const memoryMod = JSON.parse(await readFile(manifestPath)).mods.find(mod => mod.id === 'native-memory');
  assert.equal(memoryMod.compatibilityValidator, 'local-memory');
  const statePath = resolve(root, 'mods.json');
  const legacyStatePath = resolve(root, 'modules.json');
  const compatibilityPath = resolve(root, 'compatibility.json');
  await writeFile(compatibilityPath, JSON.stringify({ build: '88564', perMod: [{ id: 'native-memory', compatible: true, nativeSettingsDetected: false }] }));
  for (const enabled of [true, false]) {
    await writeFile(legacyStatePath, JSON.stringify({ version: 1, overrides: { 'native-memory': enabled } }));
    const store = new ModConfigStore({ manifestPath, statePath, legacyStatePath, compatibilityPath, activeModIDs: enabled ? ['native-memory'] : [] });
    const mod = (await store.publicState()).mods.find(mod => mod.id === 'native-memory');
    assert.equal(mod.configuredEnabled, enabled);
    assert.equal(mod.active, enabled);
    assert.equal(mod.unavailable, false);
    assert.equal(mod.pending, false);
    assert.equal((await store.publicState()).unavailableMods.includes('native-memory'), false);
  }
});
