#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureBridgeDependencies } from "./ensure-bridge-dependencies.js";

const directory = mkdtempSync(join(tmpdir(), "dia-custom-dependencies-"));
const dependency = "@openai/codex-sdk";
const packageFile = join(directory, "node_modules", dependency, "package.json");
const marker = join(directory, "node_modules/.dia-custom-dependencies.sha256");
let installs = 0;
const manifest = { dependencies: { [dependency]: "latest" } };
const lock = (version) => ({ packages: { [`node_modules/${dependency}`]: { version } } });
const writeJSON = (file, value) => writeFileSync(file, JSON.stringify(value));
const options = {
  install() {
    installs += 1;
    const currentLock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
    mkdirSync(dirname(packageFile), { recursive: true });
    writeJSON(packageFile, { version: currentLock.packages[`node_modules/${dependency}`].version });
  },
};

try {
  writeJSON(join(directory, "package.json"), manifest);
  writeJSON(join(directory, "package-lock.json"), lock("1.0.0"));
  assert.equal(ensureBridgeDependencies(directory, options), true);
  assert.equal(ensureBridgeDependencies(directory, options), false);
  assert.equal(installs, 1, "an unchanged install can be reused");

  writeJSON(join(directory, "package-lock.json"), lock("2.0.0"));
  assert.equal(ensureBridgeDependencies(directory, options), true);
  assert.equal(JSON.parse(readFileSync(packageFile, "utf8")).version, "2.0.0");
  assert.equal(installs, 2, "a still-present SDK directory cannot hide a changed lockfile");

  writeJSON(join(directory, "package.json"), { ...manifest, engines: { node: ">=24" } });
  assert.equal(ensureBridgeDependencies(directory, options), true);
  assert.equal(installs, 3, "manifest changes invalidate the cached installation");
  writeJSON(packageFile, { version: "0.0.0" });
  assert.equal(ensureBridgeDependencies(directory, options), true);
  assert.equal(installs, 4, "a replaced installed dependency is repaired");
  rmSync(packageFile);
  assert.equal(ensureBridgeDependencies(directory, options), true);
  assert.equal(installs, 5, "a missing installed dependency is repaired");

  writeJSON(join(directory, "package-lock.json"), lock("3.0.0"));
  assert.throws(() => ensureBridgeDependencies(directory, { install() { throw new Error("fixture install failure"); } }), /fixture install failure/);
  assert.equal(existsSync(marker), false, "failed installs cannot retain a stale successful marker");
  assert.throws(() => ensureBridgeDependencies(directory, { install() {} }), /do not match package-lock/);
  assert.equal(existsSync(marker), false, "incorrect installs are not cached");
  assert.equal(ensureBridgeDependencies(directory, options), true);
  assert.equal(ensureBridgeDependencies(directory, options), false);
  process.stdout.write("ok    bundled dependencies refresh for changed manifests/locks and recover from missing or failed installs\n");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
