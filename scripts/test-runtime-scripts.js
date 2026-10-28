#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBridgeHealth, stopBundledBridge } from "./bridge-runtime.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "dia-custom-runtime-"));
const profile = join(directory, "profile");
const app = join(directory, "Dia Custom Runtime [Fixture].app");
const health = {
  ok: true, coreReady: true, catalog: { modelCount: 1 }, runtimeID: "fixture-runtime",
  profileDirectory: profile, enabledMods: ["native-memory", "local-web"],
};
const assertHealth = (value) => assertBridgeHealth(value, "fixture-runtime", profile, "local-web,native-memory");
const children = [];

async function startFixture(node, script) {
  const child = spawn(node, [script], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  await once(child.stdout, "data");
  return child;
}

try {
  // Component updates register already-installed Widevine as well as fetching
  // signed component updates. Do not confuse these with stock Dia app updates.
  for (const file of [join(scriptDirectory, "launch.sh"),
    join(scriptDirectory, "../src/bootstrap/offline-bootstrap.c")]) {
    assert.doesNotMatch(await readFile(file, "utf8"), /--disable-component-update\b/,
      "ordinary launches must allow signed Chromium components to register");
  }
  assert.match(await readFile(join(scriptDirectory, "preflight-profile.sh"), "utf8"), /--disable-component-update\b/,
    "offline profile preflight must still suppress component downloads");
  assert.match(await readFile(join(scriptDirectory, "configure-profile.sh"), "utf8"), /SUEnableAutomaticChecks -bool false/);
  process.stdout.write("ok    signed Chromium components stay enabled while stock Dia updates and offline preflight stay restricted\n");
  for (const script of ["launch.sh", "preflight-profile.sh"]) {
    assert.doesNotMatch(await readFile(join(scriptDirectory, script), "utf8"),
      /--use-mock-keychain\b/, `${script} must retain existing macOS Keychain encryption`);
  }
  process.stdout.write("ok    launch and migration preflight retain the existing macOS Keychain key\n");
  const stagedVerifier = await readFile(join(scriptDirectory, "verify-staged.sh"), "utf8");
  assert.match(stagedVerifier, /check-dia-build\.js" "\$app"\s*\\\n\s*--mods "\$enabled_mods" --allow-structural/);
  assert.ok(stagedVerifier.indexOf('check-dia-build.js') < stagedVerifier.indexOf('temporary_profile='),
    "patched candidate compatibility must pass before any staged runtime starts");
  for (const script of ["verify-staged.sh", "launch.sh", "doctor.sh"]) {
    assert.match(await readFile(join(scriptDirectory, script), "utf8"), /--require-patched/,
      `${script} must reject incomplete native routing patches`);
  }
  assertHealth(health);
  assert.throws(() => assertHealth({ ...health, runtimeID: "old" }), /outdated bridge/);
  assert.throws(() => assertHealth({ ...health, profileDirectory: join(directory, "another") }), /different profile/);
  assert.throws(() => assertHealth({ ...health, enabledMods: ["local-web"] }), /Mods configuration/);
  assert.throws(() => assertHealth({ ...health, enabledMods: null }), /Mods configuration/);
  assert.throws(() => assertHealth({ ...health, coreReady: false }), /startup/);
  assert.throws(() => assertHealth({ ...health, catalog: { modelCount: 0 } }), /startup/);

  const node = join(app, "Contents/Helpers/DiaCustomNode");
  const server = join(app, "Contents/Resources/DiaCustomBridge/src/server.js");
  const decoy = join(app, "Contents/Resources/DiaCustomBridge/src/other.js");
  await mkdir(dirname(node), { recursive: true });
  await mkdir(dirname(server), { recursive: true });
  await symlink(process.execPath, node);
  await writeFile(server, "console.log('ready'); setInterval(() => {}, 1000);\n");
  await writeFile(decoy, "console.log('ready'); setInterval(() => {}, 1000);\n");
  const bridge = await startFixture(node, server);
  const unrelated = await startFixture(node, decoy);
  const exited = once(bridge, "exit");
  await stopBundledBridge(app);
  await exited;
  assert.equal(bridge.signalCode, "SIGTERM");
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  process.kill(unrelated.pid, 0);
  process.stdout.write("ok    launch health requires the expected runtime, profile, mods, and core readiness\n");
  process.stdout.write("ok    bridge cleanup stops only the exact bundled server, including paths with spaces/metacharacters\n");

  await writeFile(join(app, "Contents/Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>999999</string></dict></plist>');
  const stateDirectory = join(profile, "Bridge/.state");
  await mkdir(stateDirectory, { recursive: true });
  const env = { ...process.env, DIA_CUSTOM_PROFILE: profile };
  delete env.DIA_CUSTOM_MODS;
  delete env.DIA_CUSTOM_MODULES;
  const mods = (...args) => spawnSync(process.execPath, [join(scriptDirectory, "mods.js"), ...args], {
    encoding: "utf8", env,
  });
  const report = { build: "999999", perMod: [{ id: "morning-brief", compatible: false }] };
  await writeFile(join(stateDirectory, "compatibility.json"), JSON.stringify(report));
  let result = mods("resolved", "--app", app);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.trim().split(",").includes("morning-brief"));
  assert.ok(mods("resolved").stdout.trim().split(",").includes("morning-brief"), "requested configuration stays enabled");
  await writeFile(join(stateDirectory, "compatibility.json"), JSON.stringify({ ...report, build: "old" }));
  assert.ok(mods("resolved", "--app", app).stdout.trim().split(",").includes("morning-brief"), "stale reports are ignored");
  await writeFile(join(stateDirectory, "compatibility.json"), JSON.stringify({
    ...report, perMod: [{ id: "network-isolation", compatible: false }],
  }));
  result = mods("resolved", "--app", app);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required mod unavailable/);
  for (const args of [["resolved", "--profile"], ["resolved", "--scope", "bogus"], ["resolved", "--typo"]]) {
    assert.notEqual(mods(...args).status, 0, args.join(" "));
  }
  process.stdout.write("ok    launch resolves matching-build compatibility without changing requested mods or disabling safety mods\n");
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  await rm(directory, { recursive: true, force: true });
}
