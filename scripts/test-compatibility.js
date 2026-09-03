#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceApp = resolve(process.argv[2] ?? "/Applications/Dia.app");
const fixtureRoot = await mkdtemp(join(tmpdir(), "dia-custom-compatibility-"));
const fixtureApp = join(fixtureRoot, "Unknown Dia.app");
const sourceContents = join(sourceApp, "Contents");
const fixtureContents = join(fixtureApp, "Contents");

try {
  await mkdir(join(fixtureContents, "MacOS"), { recursive: true });
  await mkdir(join(
    fixtureContents,
    "Resources/agent-server-resources/dist/resources/tool-schemas",
  ), { recursive: true });
  await copyFile(join(sourceContents, "Info.plist"), join(fixtureContents, "Info.plist"));
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c", "Set :CFBundleVersion 999999", join(fixtureContents, "Info.plist"),
  ]);
  await symlink(join(sourceContents, "MacOS/Dia"), join(fixtureContents, "MacOS/Dia"));
  await symlink(
    join(sourceContents, "Resources/agent-server-resources/dist/handler"),
    join(fixtureContents, "Resources/agent-server-resources/dist/handler"),
  );
  await symlink(
    join(sourceContents, "Resources/agent-server-resources/dist/resources/tool-schemas/dia.json"),
    join(fixtureContents, "Resources/agent-server-resources/dist/resources/tool-schemas/dia.json"),
  );

  const result = JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "compatibility.js"),
    fixtureApp,
    "--mods", "identity-isolation,local-ai-routing,live-connectors",
    "--json",
  ], { encoding: "utf8" }));
  const perMod = Object.fromEntries(result.perMod.map((mod) => [mod.id, mod]));
  assert.equal(perMod["identity-isolation"].compatible, true);
  assert.equal(perMod["live-connectors"].compatible, true);
  assert.equal(perMod["local-ai-routing"].compatible, false);
  assert.match(perMod["local-ai-routing"].reason, /^unsupported Dia build 999999/);
  assert.doesNotMatch(perMod["local-ai-routing"].reason, /^Node\.js /);
  process.stdout.write("ok    structural compatibility reports actionable failures\n");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
