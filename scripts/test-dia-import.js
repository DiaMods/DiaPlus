#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const directory = await mkdtemp(join(tmpdir(), "dia-custom-import-test-"));
const source = join(directory, "official", "User Data");
const target = join(directory, "DiaImport");
const profile = join(source, "Default");
const extensionID = "a".repeat(32);
const extensionDirectory = join(profile, "Extensions", extensionID, "1.0.0");
const script = resolve(dirname(fileURLToPath(import.meta.url)), "prepare-dia-import.js");

try {
  await mkdir(extensionDirectory, { recursive: true });
  await writeFile(join(source, "Local State"), JSON.stringify({
    profile: { info_cache: { Default: { name: "Test" } }, last_used: "Default" },
    account_info: [{ email: "private@example.com" }],
  }));
  await writeFile(join(profile, "Bookmarks"), JSON.stringify({ roots: {} }));
  await writeFile(join(profile, "Cookies"), "secret-cookie");
  await writeFile(join(profile, "Login Data"), "secret-password");
  await writeFile(join(profile, "Preferences"), JSON.stringify({
    extensions: { settings: { [extensionID]: {
      state: 1, location: 1, path: extensionDirectory,
      manifest: { name: "Test Extension", version: "1.0.0" },
    } } },
    account_info: [{ email: "private@example.com" }],
  }));
  await writeFile(join(profile, "Secure Preferences"), "{}");
  await writeFile(join(extensionDirectory, "manifest.json"), JSON.stringify({
    name: "Test Extension", version: "1.0.0", manifest_version: 3,
  }));
  await writeFile(join(directory, "outside-secret"), "do not follow");
  await symlink(join(directory, "outside-secret"), join(extensionDirectory, "leak"));
  for (const name of ["History", "tabs.db"]) {
    const database = new DatabaseSync(join(profile, name));
    database.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('safe');");
    database.close();
  }
  await writeFile(join(profile, "Favicons"), "not a sqlite database");

  execFileSync(process.execPath, [script, "--allow-test-path"], {
    env: {
      ...process.env,
      DIA_CUSTOM_DIA_IMPORT_SOURCE: source,
      DIA_CUSTOM_DIA_IMPORT_TARGET: target,
    },
    stdio: "pipe",
  });

  const manifest = JSON.parse(await readFile(join(target, ".dia-custom-import.json"), "utf8"));
  const stagedState = JSON.parse(await readFile(join(target, "Local State"), "utf8"));
  const stagedPreferences = JSON.parse(await readFile(
    join(target, "Default", "Preferences"), "utf8"));
  assert.equal(manifest.source, "official-dia");
  assert.equal(stagedState.profile.info_cache.Default.name, "Test");
  assert.equal(stagedState.account_info, undefined);
  assert.equal(stagedPreferences.account_info, undefined);
  assert.equal(stagedPreferences.extensions.settings[extensionID].manifest.name,
    "Test Extension");
  await assert.rejects(access(join(target, "Default", "Cookies")));
  await assert.rejects(access(join(target, "Default", "Login Data")));
  await assert.rejects(access(join(
    target, "Default", "Extensions", extensionID, "1.0.0", "leak")));
  assert.equal(manifest.profiles[0].skipped[0].category, "Favicons");
  await assert.rejects(access(join(target, "Default", "Favicons")));
  for (const name of ["History", "tabs.db"]) {
    const database = new DatabaseSync(join(target, "Default", name), { readOnly: true });
    assert.equal(database.prepare("SELECT value FROM sample").get().value, "safe");
    database.close();
  }
  process.stdout.write("ok    Official Dia import staging excludes credentials and preserves safe browser data\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
