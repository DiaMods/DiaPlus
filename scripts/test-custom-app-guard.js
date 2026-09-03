#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPatchableCustomApp } from "../src/patches/custom-app-guard.js";

const directory = await mkdtemp(join(tmpdir(), "dia-custom-app-guard-"));
const plist = (bundleID) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleID}</string></dict></plist>`;

try {
  const customApp = join(directory, "Dia Custom Test.app");
  await mkdir(join(customApp, "Contents"), { recursive: true });
  await writeFile(join(customApp, "Contents/Info.plist"), plist("local.rttm.dia"));
  assert.equal(assertPatchableCustomApp(customApp), customApp);

  const renamedOfficial = join(directory, "Dia Custom Renamed Official.app");
  await mkdir(join(renamedOfficial, "Contents"), { recursive: true });
  await writeFile(
    join(renamedOfficial, "Contents/Info.plist"),
    plist("company.thebrowser.dia"),
  );
  assert.throws(() => assertPatchableCustomApp(renamedOfficial), /non-clone app/);
  assert.throws(() => assertPatchableCustomApp("/Applications/Dia.app"), /non-clone app/);
  process.stdout.write("ok    patch guard accepts only the isolated Dia Custom bundle identity\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
