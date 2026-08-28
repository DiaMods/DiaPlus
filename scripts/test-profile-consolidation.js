#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "dia-custom-consolidation-"));
const canonical = join(directory, "canonical");
const legacy = join(directory, "legacy");
const script = join(dirname(fileURLToPath(import.meta.url)), "consolidate-profile.js");

try {
  await mkdir(join(canonical, "User Data/Profile 2"), { recursive: true });
  await mkdir(join(legacy, "User Data/Default"), { recursive: true });
  await writeFile(join(canonical, "User Data/Profile 2/sentinel"), "personal");
  await writeFile(join(legacy, "User Data/Default/sentinel"), "work");
  await writeFile(join(canonical, "User Data/Local State"), JSON.stringify({
    profile: {
      last_used: "Profile 2",
      info_cache: { "Profile 2": { name: "Personal" } },
    },
  }));
  await writeFile(join(legacy, "User Data/Local State"), JSON.stringify({
    profile: {
      last_used: "Default",
      info_cache: { Default: { name: "Work" } },
    },
  }));

  await execFileAsync(process.execPath, [script, "--canonical", canonical, "--legacy", legacy]);
  const state = JSON.parse(await readFile(join(canonical, "User Data/Local State"), "utf8"));
  assert.equal(state.profile.info_cache["Profile 2"].name, "Personal");
  assert.equal(state.profile.info_cache.Default.name, "Work");
  assert.equal(state.profile.last_used, "Default");
  assert.equal(await readFile(join(canonical, "User Data/Default/sentinel"), "utf8"), "work");
  assert.equal(await readFile(join(legacy, "User Data/Default/sentinel"), "utf8"), "work");

  await execFileAsync(process.execPath, [script, "--canonical", canonical, "--legacy", legacy]);
  const secondState = JSON.parse(await readFile(join(canonical, "User Data/Local State"), "utf8"));
  assert.deepEqual(Object.keys(secondState.profile.info_cache).sort(), ["Default", "Profile 2"]);
  process.stdout.write("ok    split profiles consolidate once without modifying the legacy copy\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
