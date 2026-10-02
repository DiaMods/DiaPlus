import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { CustomUpdater } from "../src/custom-updater.js";
import { loadJSON, run, saveJSON } from "../src/updater-common.js";
import { bundle, prepared, config, source } from './release-fixtures.js';

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-updater-races-"));
  const updater = new CustomUpdater({ bridgeDirectory: "/development/bridge", profileDirectory: null, stateDirectory: directory,
    isEnabled: () => true, modConfigStore: { publicState: async () => ({ mods: [{ id: "custom-updater", configuredEnabled: true }] }) } });
  updater.app = resolve(directory, "Fixture.app");
  await mkdir(resolve(updater.app, "Contents"), { recursive: true });
  await writeFile(resolve(updater.app, "Contents/Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>1</string></dict></plist>');
  updater.assertEnabled = async () => {};
  updater.requireAccess = async () => {};
  updater.source = async () => source;
  updater.services = async () => ({ config, source, auth: { status: async () => ({ access: 'authorized' }) }, releases: { latest: async () => null } });
  t.after(async () => { await updater.preparation; await rm(directory, { recursive: true, force: true }); });
  return { updater, directory };
}

test("concurrent update preparation requests reserve one operation before reading state", async (t) => {
  const { updater } = await fixture(t);
  await saveJSON(updater.statePath, { phase: "available", bundle: bundle(), options: [{ kind: 'dia-and-mods' }], diaRelease: { build: "2" } });
  let releases;
  let started = 0;
  updater.prepareJob = async () => { started += 1; await new Promise((resolve) => { releases = resolve; }); };
  const results = await Promise.allSettled([updater.prepare(), updater.prepare()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /already running/);
  assert.equal(started, 1);
  releases();
  await updater.preparation;
  assert.equal(updater.busy, false);
});

test("double install requests cannot spawn two workers and blocked checks preserve recovery state", async (t) => {
  const { updater, directory } = await fixture(t);
  const job = resolve(updater.root, "jobs/fixture");
  const toolkit = resolve(job, "toolkit");
  const marker = resolve(directory, "worker-started");
  await mkdir(resolve(toolkit, "bridge/src"), { recursive: true });
  await writeFile(resolve(toolkit, "bridge/src/update-worker.js"), `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'started\\n');`);
  await saveJSON(resolve(job, "transaction.json"), { node: process.execPath, toolkit, env: {} });
  // This test isolates dispatch serialization; signed transaction validation is tested separately.
  updater.validatePreparedTransaction = async () => {};
  await saveJSON(updater.statePath, { phase: "ready", job, preparedMods: ["custom-updater"] });
  const results = await Promise.allSettled([updater.install(), updater.install()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /already running/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await readFile(marker, "utf8")).trim(), "started");
  await saveJSON(updater.statePath, { phase: "recovery-required", error: "existing recovery instructions" });
  await assert.rejects(updater.check(), /needs recovery/);
  assert.equal((await loadJSON(updater.statePath)).phase, "recovery-required");
  assert.equal(updater.busy, false);
});

test("updater state patches serialize without losing independent fields", async (t) => {
  const { updater } = await fixture(t);
  await Promise.all([updater.setState({ release: { build: "2" } }), updater.setState({ compatibility: { compatible: true } }), updater.setState({ phase: "ready" })]);
  const state = await loadJSON(updater.statePath);
  assert.equal(state.release.build, "2");
  assert.equal(state.compatibility.compatible, true);
  assert.equal(state.phase, "ready");
});

test("a current release clears stale failed compatibility state", async (t) => {
  const { updater } = await fixture(t);
  const source = {
    distributionPrefix: "https://releases.diabrowser.com/releases/",
    feedURL: "https://releases.diabrowser.com/releases/feed.xml",
  };
  const signature = Buffer.alloc(64).toString("base64");
  const feed = `<enclosure url="${source.distributionPrefix}Dia.zip" sparkle:version="1" sparkle:shortVersionString="1.0 (1)" length="4" sparkle:edSignature="${signature}">`;
  await saveJSON(updater.statePath, {
    phase: "failed", error: "unsupported build", job: "/stale/job",
    release: { build: "1" }, download: { percent: 100 },
    compatibility: { build: "1", requestedMods: ["custom-updater"], perMod: [
      { id: "custom-updater", compatible: false, reason: "unsupported build" },
    ] },
    disabledMods: ["custom-updater"], preparedMods: ["custom-updater"],
    runtimeID: "stale", rollbackError: "stale rollback",
  });
  updater.source = async () => source;
  updater.fetchBounded = async () => Buffer.from(feed);
  const result = await updater.check();
  assert.equal(result.phase, "current");
  for (const key of ["job", "compatibility", "download", "disabledMods", "preparedMods", "runtimeID", "rollbackError"]) {
    assert.equal(result[key], null);
  }
  assert.equal(result.error, null);
});

test("confirmed optional failures are excluded temporarily when the existing job resumes", async (t) => {
  const { updater } = await fixture(t);
  const job = resolve(updater.root, "jobs/reviewed");
  const compatibility = {
    build: "2", requestedMods: ["custom-updater", "optional"], compatible: false,
    perMod: [
      { id: "custom-updater", compatible: true, required: false },
      { id: "optional", label: "Optional mod", compatible: false, required: false, reason: "surface changed" },
    ],
  };
  await mkdir(job, { recursive: true });
  await saveJSON(updater.statePath, { phase: "compatibility-review", job, release: { build: "2" }, compatibility, bundle: await prepared(job) });
  updater.configuredMods = async () => ["custom-updater", "optional"];
  let resumed;
  let finishBuild;
  updater.buildPreparedJob = async (...args) => {
    resumed = args;
    await new Promise((resolve) => { finishBuild = resolve; });
  };
  const result = await updater.continueWithoutIncompatible();
  finishBuild();
  await updater.preparation;
  assert.deepEqual(resumed.slice(0, 2), [job, { build: "2" }]);
  assert.deepEqual(resumed[3], ["custom-updater"]);
  assert.deepEqual(resumed[4], ["custom-updater", "optional"]);
  assert.equal(result.phase, "building");
  assert.deepEqual((await loadJSON(updater.statePath)).disabledMods, ["optional"]);
});

test("updater subprocess limits remain failures when the process exits zero or ignores SIGTERM", async () => {
  await assert.rejects(run(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000)"], { timeout: 100 }), /timed out/);
  await assert.rejects(run(process.execPath, ["-e", "process.stdout.write('x'.repeat(2000));"], { maxBytes: 100 }), /output limit/);
  const start = Date.now();
  await assert.rejects(run(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], { timeout: 100 }), /timed out/);
  assert.ok(Date.now() - start < 5000);
});
