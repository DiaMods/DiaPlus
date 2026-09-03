#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

const [command, firstArgument, secondArgument] = process.argv.slice(2);

if (!command || !firstArgument ||
    !["inventory", "assert-snapshot", "assert-compatible"].includes(command) ||
    (command !== "inventory" && !secondArgument)) {
  throw new Error(
    "usage: profile-integrity.js inventory PROFILE | " +
    "assert-snapshot SOURCE SNAPSHOT | assert-compatible BASELINE CANDIDATE",
  );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJSON(path, fallback = {}) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`cannot parse ${path}: ${error.message}`);
  }
}

async function digest(path) {
  if (!(await exists(path))) return null;
  const value = await readFile(path);
  return {
    bytes: value.length,
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

async function directoryMetrics(path) {
  const result = { bytes: 0, directories: 0, files: 0 };
  if (!(await exists(path))) return result;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        result.directories += 1;
        await visit(child);
      } else if (entry.isFile()) {
        result.files += 1;
        result.bytes += (await stat(child)).size;
      }
    }
  }
  await visit(path);
  return result;
}

async function childDirectoryNames(path, pattern) {
  if (!(await exists(path))) return [];
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function fileFamily(directory, names) {
  const result = {};
  for (const name of names) {
    const value = await digest(join(directory, name));
    if (value !== null) result[name] = value;
  }
  return result;
}

function familyBytes(family) {
  return Object.values(family).reduce((sum, value) => sum + value.bytes, 0);
}

async function profileInventory(rootArgument) {
  const root = resolve(rootArgument);
  const userData = join(root, "User Data");
  const localState = await readJSON(join(userData, "Local State"));
  const cachedProfiles = Object.keys(localState?.profile?.info_cache ?? {});
  const diskProfiles = await childDirectoryNames(userData, /^(Default|Profile \d+)$/);
  const profileDirectories = [...new Set([...cachedProfiles, ...diskProfiles])]
    .filter((name) => name === "Default" || /^Profile \d+$/.test(name))
    .sort();
  const profiles = {};

  for (const name of profileDirectories) {
    const directory = join(userData, name);
    const securePreferences = await readJSON(join(directory, "Secure Preferences"));
    const extensionSettings = securePreferences?.extensions?.settings ?? {};
    const extensionIDs = Object.keys(extensionSettings).sort();
    const packageIDs = await childDirectoryNames(
      join(directory, "Extensions"), /^[a-p]{32}$/,
    );
    const packageIDSet = new Set(packageIDs);
    const userExtensionIDs = extensionIDs.filter((id) => {
      const record = extensionSettings[id];
      return record?.manifest && record?.path && (
        packageIDSet.has(id) ||
        (record.was_installed_by_default !== true && isAbsolute(record.path) &&
          !record.path.includes(".app/Contents/"))
      );
    });
    const extensionPackages = {};
    for (const id of packageIDs) {
      const packageDirectory = join(directory, "Extensions", id);
      extensionPackages[id] = await directoryMetrics(packageDirectory);
    }

    const stateDirectories = {};
    for (const stateName of [
      "Extension State",
      "Local Extension Settings",
      "Managed Extension Settings",
      "Sync Extension Settings",
    ]) {
      stateDirectories[stateName] = {
        ids: await childDirectoryNames(join(directory, stateName), /^[a-p]{32}$/),
        metrics: await directoryMetrics(join(directory, stateName)),
      };
    }

    const sessionDirectory = join(directory, "Sessions");
    const sessionNames = (await exists(sessionDirectory))
      ? (await readdir(sessionDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^(Session|Tabs)_\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
      : [];

    profiles[name] = {
      displayName: localState?.profile?.info_cache?.[name]?.name ?? null,
      extensionIDs,
      extensionPackages,
      preferences: await fileFamily(directory, ["Preferences", "Secure Preferences"]),
      sessions: await fileFamily(sessionDirectory, sessionNames),
      stateDirectories,
      tabsDatabase: await fileFamily(directory, ["tabs.db", "tabs.db-wal", "tabs.db-shm"]),
      userExtensionIDs,
    };
  }

  return {
    profileRootName: basename(root),
    profiles,
    version: 1,
  };
}

function withoutRootName(value) {
  return { ...value, profileRootName: "<profile>" };
}

function missingValues(baseline, candidate) {
  const available = new Set(candidate);
  return baseline.filter((value) => !available.has(value));
}

function compatibilityFailures(baseline, candidate) {
  const failures = [];
  for (const [name, expected] of Object.entries(baseline.profiles)) {
    const actual = candidate.profiles[name];
    if (!actual) {
      failures.push(`${name}: profile directory disappeared`);
      continue;
    }
    const missingPackages = missingValues(
      Object.keys(expected.extensionPackages), Object.keys(actual.extensionPackages),
    );
    if (missingPackages.length > 0) {
      failures.push(`${name}: ${missingPackages.length} extension package(s) disappeared`);
    }
    const missingExtensions = missingValues(expected.userExtensionIDs, actual.userExtensionIDs);
    if (missingExtensions.length > 0) {
      failures.push(`${name}: ${missingExtensions.length} extension registration(s) were rejected`);
    }
    for (const [stateName, expectedState] of Object.entries(expected.stateDirectories)) {
      const actualState = actual.stateDirectories[stateName] ?? { ids: [] };
      const missingState = missingValues(expectedState.ids, actualState.ids);
      if (missingState.length > 0) {
        failures.push(`${name}: ${missingState.length} ${stateName} store(s) disappeared`);
      }
    }
    const expectedSessionBytes = familyBytes(expected.sessions);
    const actualSessionBytes = familyBytes(actual.sessions);
    if (expectedSessionBytes > 0 && actualSessionBytes === 0) {
      failures.push(`${name}: open-tab session files disappeared`);
    }
    const expectedTabsBytes = familyBytes(expected.tabsDatabase);
    const actualTabsBytes = familyBytes(actual.tabsDatabase);
    if (expectedTabsBytes > 0 && actualTabsBytes === 0) {
      failures.push(`${name}: pinned-tab database disappeared`);
    }
  }
  return failures;
}

const first = resolve(firstArgument);
if (command === "inventory") {
  process.stdout.write(`${JSON.stringify(await profileInventory(first), null, 2)}\n`);
  process.exit(0);
}

const second = resolve(secondArgument);
const baseline = await profileInventory(first);
const candidate = await profileInventory(second);
if (command === "assert-snapshot") {
  assert.deepEqual(withoutRootName(candidate), withoutRootName(baseline),
    "profile snapshot does not exactly preserve critical browser data");
  process.stdout.write("Profile snapshot exactly preserves critical browser data.\n");
  process.exit(0);
}

const failures = compatibilityFailures(baseline, candidate);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Candidate profile retained sessions, pinned tabs, and extensions.\n");
