#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPatchableCustomApp } from "../src/patches/custom-app-guard.js";
import { assertBuildTarget } from "./check-app-target.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "dia-custom-app-guard-"));
const plist = (bundleID) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleID}</string></dict></plist>`;

try {
  const customApp = join(directory, "Dia Custom Test.app");
  await mkdir(join(customApp, "Contents"), { recursive: true });
  await writeFile(join(customApp, "Contents/Info.plist"), plist("local.rttm.dia"));
  assert.equal(assertPatchableCustomApp(customApp), customApp);
  const plus = join(directory, 'Dia+.app');
  await mkdir(join(plus, 'Contents'), { recursive: true });
  await writeFile(join(plus, 'Contents/Info.plist'), plist('local.rttm.dia'));
  assert.equal(assertPatchableCustomApp(plus), plus);
  const plusOfficial = join(directory, 'Dia+.official.app');
  await mkdir(join(plusOfficial, 'Contents'), { recursive: true });
  await writeFile(join(plusOfficial, 'Contents/Info.plist'), plist('company.thebrowser.dia'));
  assert.throws(() => assertPatchableCustomApp(plusOfficial), /non-clone app/);

  const renamedOfficial = join(directory, "Dia Custom Renamed Official.app");
  await mkdir(join(renamedOfficial, "Contents"), { recursive: true });
  await writeFile(
    join(renamedOfficial, "Contents/Info.plist"),
    plist("company.thebrowser.dia"),
  );
  assert.throws(() => assertPatchableCustomApp(renamedOfficial), /non-clone app/);
  assert.throws(() => assertPatchableCustomApp("/Applications/Dia.app"), /non-clone app/);

  assert.equal(assertBuildTarget(renamedOfficial, customApp), await realpath(customApp));
  assert.equal(assertBuildTarget(renamedOfficial, join(directory, "Dia Custom New.app")),
    join(await realpath(directory), "Dia Custom New.app"));
  assert.throws(() => assertBuildTarget(customApp, join(directory, "Dia Custom New.app")),
    /not an official Dia app/);
  assert.throws(() => assertBuildTarget(renamedOfficial, renamedOfficial), /source Dia app/);
  assert.throws(() => assertBuildTarget(renamedOfficial, join(renamedOfficial, "Dia Custom Nested.app")),
    /source Dia app/);
  const alias = join(directory, "Dia Custom Alias.app");
  await symlink(renamedOfficial, alias);
  assert.throws(() => assertBuildTarget(renamedOfficial, alias), /source Dia app/);
  assert.throws(() => assertBuildTarget(renamedOfficial, join(alias, "Dia Custom Nested.app")),
    /source Dia app/);
  const foreignApp = join(directory, "Dia Custom Foreign.app");
  await mkdir(join(foreignApp, "Contents"), { recursive: true });
  await writeFile(join(foreignApp, "Contents/Info.plist"), plist("example.foreign"));
  assert.throws(() => assertBuildTarget(renamedOfficial, foreignApp), /non-clone app/);

  // Exercise the entry points with deliberately incomplete bundles: validation
  // must reject them before snapshotting profiles or touching the app plist.
  const originalPlist = await readFile(join(renamedOfficial, "Contents/Info.plist"), "utf8");
  const env = { ...process.env, DIA_CUSTOM_PROFILE: join(directory, "unused-profile") };
  const install = spawnSync("/bin/zsh", [join(scriptDirectory, "install.sh"), renamedOfficial],
    { env, encoding: "utf8" });
  assert.notEqual(install.status, 0);
  assert.match(install.stderr, /refusing to patch a non-clone app/);
  const build = spawnSync("/bin/zsh", [join(scriptDirectory, "build.sh"), "--replace"], {
    env: { ...env, DIA_CUSTOM_SOURCE_APP: renamedOfficial, DIA_CUSTOM_APP: alias }, encoding: "utf8",
  });
  assert.notEqual(build.status, 0);
  assert.match(build.stderr, /refusing to build over or inside the source Dia app/);
  assert.equal(await readFile(join(renamedOfficial, "Contents/Info.plist"), "utf8"), originalPlist);
  process.stdout.write("ok    patch guard accepts only the isolated Dia Custom bundle identity\n");
  process.stdout.write("ok    install/build reject official and overlapping app targets before mutation\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
