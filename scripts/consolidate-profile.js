#!/usr/bin/env node

import { cp, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const options = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, values) => {
    if (value.startsWith("--") && values[index + 1] && !values[index + 1].startsWith("--")) {
      pairs.push([value.slice(2), values[index + 1]]);
    }
    return pairs;
  }, []),
);
if (!options.canonical || !options.legacy) {
  throw new Error("usage: consolidate-profile.js --canonical DIR --legacy DIR [--marker FILE]");
}

const canonical = resolve(options.canonical);
const legacy = resolve(options.legacy);
const canonicalUserData = join(canonical, "User Data");
const legacyUserData = join(legacy, "User Data");
const canonicalStatePath = join(canonicalUserData, "Local State");
const legacyStatePath = join(legacyUserData, "Local State");
const markerPath = resolve(options.marker ?? join(canonical, "Bridge/.state/profile-consolidation.json"));

async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

let existingMarker;
try {
  existingMarker = await readJSON(markerPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (existingMarker?.complete) {
  process.stdout.write("Split Dia Custom profile data was already consolidated.\n");
  process.exit(0);
}

const canonicalState = await readJSON(canonicalStatePath);
const legacyState = await readJSON(legacyStatePath);
const canonicalCache = canonicalState.profile?.info_cache ?? {};
const legacyCache = legacyState.profile?.info_cache ?? {};
const usedDirectories = new Set(Object.keys(canonicalCache));
const imported = [];

function nextProfileDirectory(preferred) {
  if (!usedDirectories.has(preferred)) return preferred;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `Profile ${index}`;
    if (!usedDirectories.has(candidate)) return candidate;
  }
  throw new Error("could not allocate a destination profile directory");
}

await mkdir(canonicalUserData, { recursive: true, mode: 0o700 });
await mkdir(resolve(markerPath, ".."), { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const stateBackup = `${canonicalStatePath}.pre-consolidation-${stamp}`;
await copyFile(canonicalStatePath, stateBackup);

for (const [sourceDirectory, metadata] of Object.entries(legacyCache)) {
  const source = join(legacyUserData, sourceDirectory);
  const destinationDirectory = nextProfileDirectory(sourceDirectory);
  const destination = join(canonicalUserData, destinationDirectory);
  const staging = join(canonicalUserData, `.dia-custom-consolidating-${destinationDirectory}`);
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false,
  });
  await rm(join(staging, "AgentServer/server.pid"), { force: true });
  await rename(staging, destination);
  usedDirectories.add(destinationDirectory);
  canonicalCache[destinationDirectory] = metadata;
  imported.push({
    sourceDirectory,
    destinationDirectory,
    name: metadata?.name ?? basename(sourceDirectory),
  });
}

canonicalState.profile ??= {};
canonicalState.profile.info_cache = canonicalCache;
const legacyLastUsed = legacyState.profile?.last_used;
const mappedLastUsed = imported.find(({ sourceDirectory }) => sourceDirectory === legacyLastUsed)
  ?.destinationDirectory ?? imported.at(0)?.destinationDirectory;
if (mappedLastUsed) canonicalState.profile.last_used = mappedLastUsed;
canonicalState.profile.last_active_profiles = [
  ...new Set([
    ...(canonicalState.profile.last_active_profiles ?? []),
    ...imported.map(({ destinationDirectory }) => destinationDirectory),
  ]),
];
await writeFile(canonicalStatePath, JSON.stringify(canonicalState), { mode: 0o600 });
await writeFile(markerPath, JSON.stringify({
  complete: true,
  completedAt: new Date().toISOString(),
  canonical,
  legacy,
  legacyPreserved: true,
  stateBackup,
  imported,
}, null, 2), { mode: 0o600 });

process.stdout.write(
  `Consolidated ${imported.length} profile(s): ${imported.map(({ name }) => name).join(", ")}.\n` +
  `The original profile remains unchanged at ${legacy}.\n`,
);
