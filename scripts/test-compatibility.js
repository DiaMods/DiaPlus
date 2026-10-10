#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceApp = resolve(process.argv[2] ?? "/Applications/Dia.app");
const fixtureRoot = await mkdtemp(join(tmpdir(), "dia-custom-compatibility-"));
const fixtureApp = join(fixtureRoot, "Dia Custom Compatibility.app");
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
  assert.match(perMod["local-ai-routing"].reason,
    /^(unsupported Dia build 999999|expected one unpatched endpoint)/);
  assert.doesNotMatch(perMod["local-ai-routing"].reason, /^Node\.js /);
  process.stdout.write("ok    structural compatibility reports actionable failures\n");

  const checked = JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "check-dia-build.js"), fixtureApp,
    "--mods", "identity-isolation,live-connectors", "--allow-structural", "--json",
  ], { encoding: "utf8" }));
  assert.equal(checked.build, "999999");
  assert.equal(checked.status, "structurally-compatible");
  assert.equal(checked.version, result.version);
  assert.equal(checked.compatibility.length, 2);
  process.stdout.write("ok    unknown builds return successful structural validation without an audited record\n");

  // An audited build number is metadata, not proof that its native action still
  // matches the ABI. Break an actual prologue while preserving that metadata.
  await copyFile(join(sourceContents, "Info.plist"), join(fixtureContents, "Info.plist"));
  const sourceBuild = execFileSync("/usr/libexec/PlistBuddy", [
    "-c", "Print :CFBundleVersion", join(sourceContents, "Info.plist"),
  ], { encoding: "utf8" }).trim();
  const discovered = JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "../src/bootstrap/discover-native-actions.js"),
    join(sourceContents, "MacOS/Dia"), sourceBuild,
  ], { encoding: "utf8" }));
  await rm(join(fixtureContents, "MacOS/Dia"));
  await copyFile(join(sourceContents, "MacOS/Dia"), join(fixtureContents, "MacOS/Dia"));
  const routing = () => JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "compatibility.js"), fixtureApp,
    "--mods", "local-ai-routing", "--json",
  ], { encoding: "utf8" })).perMod[0];
  assert.equal(routing().compatible, true, "original endpoints must validate");
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c", "Set :CFBundleIdentifier local.rttm.dia", join(fixtureContents, "Info.plist"),
  ]);
  execFileSync(process.execPath, [
    join(scriptDirectory, "../src/patches/patch-endpoint.js"), fixtureApp,
  ], { encoding: "utf8" });
  assert.equal(routing().compatible, true, "the exact installed local endpoints must validate");
  const patchedPath = join(fixtureContents, "MacOS/Dia");
  const patched = await readFile(patchedPath);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  execFileSync(process.execPath, [
    join(scriptDirectory, "../src/patches/patch-endpoint.js"), "--check", fixtureApp,
  ], { encoding: "utf8" });
  assert.equal(digest(await readFile(patchedPath)), digest(patched), "checking must not modify the executable");
  if (["87864", "88564"].includes(sourceBuild)) {
    const resolver = sourceBuild === "87864" ? 0xf68794 : 0xfb09bc;
    const destructor = sourceBuild === "87864" ? 0xf687b0 : 0xfb09d8;
    const guards = sourceBuild === "87864"
      ? [0x8cac8, 0xf6734c, 0x2ce6674, 0x5b4243c, 0x60cee90]
      : [0x8c040, 0xfaf574, 0x2ef0144, 0x5c0cabc, 0x60f7520];
    for (const offset of [resolver, destructor, destructor + 4, ...guards]) {
      const invalid = Buffer.from(patched);
      invalid[offset] ^= 1;
      await writeFile(patchedPath, invalid);
      assert.throws(() => execFileSync(process.execPath, [
        join(scriptDirectory, "../src/patches/patch-endpoint.js"), fixtureApp,
      ], { stdio: "pipe" }), /AI service|expected one unpatched endpoint/);
      assert.equal(digest(await readFile(patchedPath)), digest(invalid), "reject changed AI service ABI without a partial write");
    }
    const referenced = Buffer.from(patched);
    referenced.writeUInt32LE((0x14000000 | ((destructor + 8 - 0x3200) / 4 & 0x03ffffff)) >>> 0, 0x3200);
    await writeFile(patchedPath, referenced);
    assert.throws(() => execFileSync(process.execPath, [
      join(scriptDirectory, "../src/patches/patch-endpoint.js"), fixtureApp,
    ], { stdio: "pipe" }), /AI service URL continuation gained a reference/);
    assert.equal(digest(await readFile(patchedPath)), digest(referenced),
      "reject an unexpected native continuation caller without writing");
    await writeFile(patchedPath, patched);
  }
  if (sourceBuild === "88564") {
    // Removed URLs are an audited absence, not optional patch sites. Neither
    // their hosted form nor a stale local replacement may silently reappear.
    for (const endpoint of [
      "https://model-server.browserinternalstaging.com",
      "http://localhost:8765/model-registry-local-xxxx",
    ]) {
      const invalid = Buffer.concat([patched, Buffer.from(endpoint)]);
      await writeFile(patchedPath, invalid);
      assert.throws(() => execFileSync(process.execPath, [
        join(scriptDirectory, "../src/patches/patch-endpoint.js"), fixtureApp,
      ], { stdio: "pipe" }), /removed model-server endpoint/);
      assert.equal(digest(await readFile(patchedPath)), digest(invalid),
        "reject a reintroduced endpoint without a partial write");
    }
    await writeFile(patchedPath, patched);
  }
  const endpoint = Buffer.from(["87561", "87864", "88564"].includes(sourceBuild)
    ? "http://localhost:8765/aiproxy/dia-claude-stream-local-testxx"
    : "http://localhost:8765/tools-cache-local-xx");
  const endpointOffset = patched.indexOf(endpoint);
  assert.ok(endpointOffset >= 0);
  const endpointFile = await open(patchedPath, "r+");
  try {
    await endpointFile.write(Buffer.from("y"), 0, 1, endpointOffset + endpoint.length - 1);
  } finally {
    await endpointFile.close();
  }
  const corruptedRouting = routing();
  assert.equal(corruptedRouting.compatible, false);
  assert.match(corruptedRouting.reason, /expected one unpatched endpoint/);
  assert.throws(() => execFileSync(process.execPath, [
    join(scriptDirectory, "check-dia-build.js"), fixtureApp,
    "--mods", "local-ai-routing", "--allow-structural", "--json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  /expected one unpatched endpoint/);
  process.stdout.write("ok    endpoint validation accepts exact original/patched layouts, stays read-only, and rejects corrupted local routes\n");
  const executable = await open(join(fixtureContents, "MacOS/Dia"), "r+");
  try {
    await executable.write(Buffer.alloc(4), 0, 4, discovered.morningBriefOffset);
  } finally {
    await executable.close();
  }
  const changed = JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "compatibility.js"), fixtureApp,
    "--mods", "morning-brief", "--json",
  ], { encoding: "utf8" }));
  assert.equal(changed.perMod[0].compatible, false);
  assert.match(changed.perMod[0].reason, /Morning Brief synchronous method ABI changed/);
  const registry = JSON.parse(await readFile(
    join(scriptDirectory, "../src/config/supported-dia-builds.json"), "utf8"));
  if (registry.builds[sourceBuild]) {
    assert.throws(() => execFileSync(process.execPath, [
      join(scriptDirectory, "check-dia-build.js"), fixtureApp,
      "--mods", "morning-brief", "--json",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    /native Morning Brief synchronous method ABI changed/);
  }
  process.stdout.write("ok    audited build metadata cannot bypass a changed native Morning Brief ABI\n");

  const appearance = JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "../src/bootstrap/check-new-tab-state.js"), join(sourceContents, "MacOS/Dia"),
  ], { encoding: "utf8" }));
  const fieldRecord = Number.parseInt(appearance.offset, 16) + 16 + (appearance.fieldCount - 2) * 12;
  const appearanceBytes = await readFile(join(fixtureContents, "MacOS/Dia"));
  const fieldNameOffset = fieldRecord + 8 + appearanceBytes.readInt32LE(fieldRecord + 8);
  const appearanceFile = await open(join(fixtureContents, "MacOS/Dia"), "r+");
  try {
    await appearanceFile.write(Buffer.from("x"), 0, 1, fieldNameOffset);
  } finally {
    await appearanceFile.close();
  }
  const changedAppearance = JSON.parse(execFileSync(process.execPath, [
    join(scriptDirectory, "compatibility.js"), fixtureApp,
    "--mods", "native-apps", "--json",
  ], { encoding: "utf8" }));
  assert.equal(changedAppearance.perMod[0].compatible, false);
  assert.match(changedAppearance.perMod[0].reason, /native Advanced Chat state layout changed/);
  process.stdout.write("ok    native Apps compatibility rejects a changed Advanced Chat appearance layout\n");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
