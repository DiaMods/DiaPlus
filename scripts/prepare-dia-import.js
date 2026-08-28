#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

const values = process.argv.slice(2);
const statusOnly = values.includes("--status");
const allowTestPath = values.includes("--allow-test-path");
const source = resolve(process.env.DIA_CUSTOM_DIA_IMPORT_SOURCE ??
  join(homedir(), "Library/Application Support/Dia/User Data"));
const target = resolve(process.env.DIA_CUSTOM_DIA_IMPORT_TARGET ??
  join(homedir(), "Library/Application Support/DiaImport"));

if (!allowTestPath &&
    (basename(target) !== "DiaImport" || basename(dirname(target)) !== "Application Support")) {
  throw new Error(`refusing unsafe Dia import staging target: ${target}`);
}
if (source === target || target.startsWith(`${source}/`)) {
  throw new Error("Dia import staging cannot overlap the official Dia profile");
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
    throw new Error(`cannot safely parse ${path}: ${error.message}`);
  }
}

function profileDirectories(localState) {
  const cached = Object.keys(localState?.profile?.info_cache ?? {});
  return [...new Set(["Default", ...cached])].filter((name) =>
    name === "Default" || /^Profile \d+$/.test(name));
}

function sanitizedLocalState(localState, profiles) {
  const info = localState?.profile?.info_cache ?? {};
  const safeCache = {};
  for (const profile of profiles) {
    const record = info[profile] ?? {};
    safeCache[profile] = Object.fromEntries(Object.entries({
      name: record.name ?? (profile === "Default" ? "Personal" : profile),
      avatar_icon: record.avatar_icon,
      is_using_default_name: record.is_using_default_name,
    }).filter(([, value]) => value !== undefined));
  }
  return {
    profile: {
      info_cache: safeCache,
      last_used: profiles.includes(localState?.profile?.last_used)
        ? localState.profile.last_used : profiles[0],
    },
  };
}

function sanitizedPreferences(preferences) {
  const settings = preferences?.extensions?.settings ?? {};
  const safeSettings = {};
  for (const [id, record] of Object.entries(settings)) {
    if (!/^[a-p]{32}$/.test(id) || typeof record !== "object" || record === null) continue;
    safeSettings[id] = Object.fromEntries(Object.entries({
      state: record.state,
      location: record.location,
      manifest: record.manifest,
      from_webstore: record.from_webstore,
      creation_flags: record.creation_flags,
      was_installed_by_default: record.was_installed_by_default,
    }).filter(([, value]) => value !== undefined));
  }
  return { extensions: { settings: safeSettings } };
}

async function writeJSON(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function copyFileIfPresent(from, to) {
  if (!(await exists(from))) return false;
  if (!(await lstat(from)).isFile()) return false;
  await cp(from, to, { force: true, dereference: false });
  await chmod(to, 0o600);
  return true;
}

async function backupDatabaseIfPresent(from, to) {
  if (!(await exists(from))) return false;
  if (!(await lstat(from)).isFile()) return false;
  const database = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(database, to);
  } catch (error) {
    await rm(to, { force: true });
    throw error;
  } finally {
    database.close();
  }
  await chmod(to, 0o600);
  return true;
}

async function copyOpaqueDatabaseFamily(from, to) {
  if (!(await exists(from)) || !(await lstat(from)).isFile()) return false;
  const members = ["", "-wal", "-shm"];
  const fingerprint = async () => {
    const values = [];
    for (const suffix of members) {
      try {
        const value = await stat(`${from}${suffix}`);
        values.push(`${suffix}:${value.size}:${value.mtimeMs}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return values.join("|");
  };
  for (let attempt = 0; attempt < 3; ++attempt) {
    const before = await fingerprint();
    for (const suffix of members) {
      if (await exists(`${from}${suffix}`)) {
        await copyFileIfPresent(`${from}${suffix}`, `${to}${suffix}`);
      }
    }
    if (before === await fingerprint()) return true;
    for (const suffix of members) {
      if (await exists(`${to}${suffix}`)) await rm(`${to}${suffix}`, { force: true });
    }
  }
  throw new Error("source changed during snapshot");
}

async function copyExtensions(from, to) {
  if (!(await exists(from))) return 0;
  async function copySafeTree(sourceDirectory, targetDirectory) {
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await chmod(targetDirectory, 0o700);
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      const sourcePath = join(sourceDirectory, entry.name);
      const targetPath = join(targetDirectory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await copySafeTree(sourcePath, targetPath);
      } else if (entry.isFile()) {
        await cp(sourcePath, targetPath, { force: true });
        await chmod(targetPath, 0o600);
      }
    }
  }
  await copySafeTree(from, to);
  const entries = await readdir(to, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && /^[a-p]{32}$/.test(entry.name)).length;
}

if (statusOnly) {
  const manifest = await readJSON(join(target, ".dia-custom-import.json"), null);
  process.stdout.write(`${JSON.stringify({
    sourceAvailable: await exists(join(source, "Local State")),
    staged: manifest !== null,
    target,
    manifest,
  }, null, 2)}\n`);
  process.exit(0);
}

if (!(await exists(join(source, "Local State")))) {
  throw new Error(`official Dia profile is unavailable at ${source}`);
}

const localState = await readJSON(join(source, "Local State"));
const candidates = profileDirectories(localState);
const profiles = [];
for (const name of candidates) {
  if (await exists(join(source, name))) profiles.push(name);
}
if (profiles.length === 0) throw new Error("official Dia has no importable profiles");

const temporary = `${target}.staging-${process.pid}-${randomBytes(4).toString("hex")}`;
const previous = `${target}.previous-${process.pid}`;
await mkdir(temporary, { recursive: true, mode: 0o700 });
await chmod(temporary, 0o700);
const summary = [];

try {
  await writeJSON(join(temporary, "Local State"), sanitizedLocalState(localState, profiles));
  for (const name of profiles) {
    const from = join(source, name);
    const to = join(temporary, name);
    await mkdir(to, { recursive: true, mode: 0o700 });
    const preferences = await readJSON(join(from, "Preferences"), {});
    await writeJSON(join(to, "Preferences"), sanitizedPreferences(preferences));
    await writeJSON(join(to, "Secure Preferences"), sanitizedPreferences(
      await readJSON(join(from, "Secure Preferences"), {}),
    ));
    const categories = [];
    const skipped = [];
    for (const file of ["Bookmarks", "Bookmarks.bak", "BookmarkMergedSurfaceOrdering"]) {
      if (await copyFileIfPresent(join(from, file), join(to, file))) categories.push(file);
    }
    for (const file of ["History", "Favicons"]) {
      try {
        if (await backupDatabaseIfPresent(join(from, file), join(to, file))) categories.push(file);
      } catch (error) {
        skipped.push({ category: file, reason: "database is busy or incompatible" });
      }
    }
    try {
      if (await copyOpaqueDatabaseFamily(join(from, "tabs.db"), join(to, "tabs.db"))) {
        categories.push("tabs.db");
      }
    } catch (error) {
      skipped.push({ category: "tabs.db", reason: "database changed during snapshot" });
    }
    const extensions = await copyExtensions(join(from, "Extensions"), join(to, "Extensions"));
    if (extensions > 0) categories.push("Extensions");
    summary.push({ profile: name, name: localState?.profile?.info_cache?.[name]?.name ?? name,
      categories, extensions, skipped });
  }
  await writeJSON(join(temporary, ".dia-custom-import.json"), {
    version: 1,
    createdAt: new Date().toISOString(),
    source: "official-dia",
    excluded: [
      "account tokens", "cookies", "saved passwords", "Keychain data",
      "chats", "Memory", "reports", "open sessions", "extension site data",
    ],
    profiles: summary,
  });
  if (await exists(target)) await rename(target, previous);
  await rename(temporary, target);
  if (await exists(previous)) await rm(previous, { recursive: true, force: true });
} catch (error) {
  if (await exists(temporary)) await rm(temporary, { recursive: true, force: true });
  if (!(await exists(target)) && await exists(previous)) await rename(previous, target);
  throw error;
}

process.stdout.write(
  `Prepared ${profiles.length} official Dia profile(s) for the native importer at ${target}.\n`,
);
for (const profile of summary) {
  for (const item of profile.skipped) {
    process.stderr.write(
      `Warning: ${profile.name} ${item.category} was skipped because its ${item.reason}. Quit official Dia and refresh the import to include it.\n`,
    );
  }
}
