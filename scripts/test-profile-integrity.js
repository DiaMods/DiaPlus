#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "dia-custom-profile-integrity-"));
const source = join(directory, "source");
const snapshot = join(directory, "snapshot");
const broken = join(directory, "broken");
const profile = join(source, "User Data", "Default");
const extensionID = "a".repeat(32);
const script = resolve(dirname(fileURLToPath(import.meta.url)), "profile-integrity.js");

async function createFixture() {
  await mkdir(join(profile, "Sessions"), { recursive: true });
  await mkdir(join(profile, "Extensions", extensionID, "1.0.0"), { recursive: true });
  await mkdir(join(profile, "Local Extension Settings", extensionID), { recursive: true });
  await writeFile(join(source, "User Data", "Local State"), JSON.stringify({
    profile: { info_cache: { Default: { name: "Personal" } }, last_used: "Default" },
  }));
  await writeFile(join(profile, "Preferences"), "{}");
  await writeFile(join(profile, "Secure Preferences"), JSON.stringify({
    extensions: { settings: { [extensionID]: {
      from_webstore: true,
      manifest: { name: "Fixture", version: "1.0.0" },
      path: `${extensionID}/1.0.0`,
    } } },
  }));
  await writeFile(join(profile, "Sessions", "Session_123"), "open tabs");
  await writeFile(join(profile, "Sessions", "Tabs_123"), "tab navigation");
  await writeFile(join(profile, "tabs.db"), "pinned tabs");
  await writeFile(join(profile, "tabs.db-wal"), "pending pinned tabs");
  await writeFile(join(profile, "Extensions", extensionID, "1.0.0", "manifest.json"),
    JSON.stringify({ name: "Fixture", version: "1.0.0", manifest_version: 3 }));
  await writeFile(join(profile, "Local Extension Settings", extensionID, "000003.log"),
    "extension data");
}

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

try {
  await createFixture();
  await cp(source, snapshot, { recursive: true });
  execFileSync(process.execPath, [script, "assert-snapshot", source, snapshot], {
    stdio: "pipe",
  });

  await cp(snapshot, broken, { recursive: true });
  await rm(join(broken, "User Data", "Default", "Extensions", extensionID), {
    recursive: true,
  });
  let result = run("assert-compatible", snapshot, broken);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /extension package/);

  await rm(broken, { recursive: true });
  await cp(snapshot, broken, { recursive: true });
  const securePath = join(broken, "User Data", "Default", "Secure Preferences");
  const secure = JSON.parse(await readFile(securePath, "utf8"));
  secure.extensions.settings = {};
  await writeFile(securePath, JSON.stringify(secure));
  result = run("assert-compatible", snapshot, broken);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /registration/);

  await rm(broken, { recursive: true });
  await cp(snapshot, broken, { recursive: true });
  await rm(join(broken, "User Data", "Default", "Sessions"), { recursive: true });
  await rm(join(broken, "User Data", "Default", "tabs.db"));
  await rm(join(broken, "User Data", "Default", "tabs.db-wal"));
  result = run("assert-compatible", snapshot, broken);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /session files disappeared/);
  assert.match(result.stderr, /pinned-tab database disappeared/);

  process.stdout.write(
    "ok    Profile integrity guard covers extensions, sessions, and pinned tabs\n",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
