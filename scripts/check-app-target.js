#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPatchableCustomApp } from "../src/patches/custom-app-guard.js";

// Resolve existing ancestors too, so a not-yet-created target cannot bypass
// the source boundary by going through a symlinked directory.
function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}

function containsPath(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

export function assertBuildTarget(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) throw new Error("build requires source and target app paths");
  const source = canonicalPath(resolve(sourcePath));
  const target = canonicalPath(resolve(targetPath));
  if (containsPath(source, target) || containsPath(target, source)) {
    throw new Error("refusing to build over or inside the source Dia app");
  }
  if (!basename(target).startsWith("Dia Custom") || !basename(target).endsWith(".app")) {
    throw new Error(`refusing to build a non-clone app target: ${target}`);
  }
  const sourceID = execFileSync("/usr/libexec/PlistBuddy", [
    "-c", "Print :CFBundleIdentifier", join(source, "Contents/Info.plist"),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (sourceID !== "company.thebrowser.dia") {
    throw new Error(`build source is not an official Dia app: ${source}`);
  }
  try {
    lstatSync(resolve(targetPath));
    assertPatchableCustomApp(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second, ...extra] = process.argv.slice(2);
  if (command === "install" && first && !second) {
    assertPatchableCustomApp(canonicalPath(resolve(first)));
  } else if (command === "build" && first && second && extra.length === 0) {
    assertBuildTarget(first, second);
  } else {
    throw new Error("usage: check-app-target.js install APP | build SOURCE_APP TARGET_APP");
  }
}
