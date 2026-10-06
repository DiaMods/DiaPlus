#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const manifestPath = resolve(projectDirectory, "bridge/config/dia-mods.json");

function parseArguments(argv) {
  const values = [...argv];
  const command = values.shift() ?? "list";
  let profile = process.env.DIA_CUSTOM_PROFILE ??
    resolve(homedir(), "Library/Application Support/Dia Custom RTTM");
  let json = false;
  let scope = null;
  let app = null;
  const positional = [];
  const optionValue = (name) => {
    const value = values.shift();
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  };
  while (values.length > 0) {
    const value = values.shift();
    if (value === "--profile") {
      profile = resolve(optionValue(value));
    } else if (value === "--json") {
      json = true;
    } else if (value === "--scope") {
      scope = optionValue(value);
    } else if (value === "--app") {
      app = resolve(optionValue(value));
    } else if (value.startsWith("--")) {
      throw new Error(`unknown Dia Mods option: ${value}`);
    } else {
      positional.push(value);
    }
  }
  return { command, profile, json, scope, app, positional };
}

async function loadJSON(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function exactEnvironmentSelection(mods) {
  const raw = process.env.DIA_CUSTOM_MODS ?? process.env.DIA_CUSTOM_MODULES;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const selected = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
  const known = new Set(mods.map((mod) => mod.id));
  const unknown = [...selected].filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown DIA_CUSTOM_MODS: ${unknown.join(", ")}`);
  return selected;
}

function resolveMods(mods, state) {
  const environment = exactEnvironmentSelection(mods);
  return mods.map((mod) => {
    const configured = state?.overrides?.[mod.id];
    const enabled = mod.required || (environment
      ? environment.has(mod.id)
      : typeof configured === "boolean"
        ? configured
        : mod.defaultEnabled !== false);
    return {
      ...mod,
      enabled: mod.availability === "pending-audit" ? false : enabled,
      source: mod.availability === "pending-audit" ? "pending-audit" : mod.required
        ? "required"
        : environment
          ? "environment"
          : typeof configured === "boolean"
            ? "profile"
            : "default",
    };
  });
}

function validateResolvedMods(mods) {
  const byID = new Map(mods.map((mod) => [mod.id, mod]));
  for (const mod of mods.filter((candidate) => candidate.enabled)) {
    for (const id of mod.requires ?? []) {
      if (!byID.get(id)?.enabled) {
        throw new Error(`${mod.id} requires Dia Mod ${id}`);
      }
    }
    for (const id of new Set([...(mod.conflicts ?? []), ...(mod.replaces ?? [])])) {
      if (byID.get(id)?.enabled) {
        throw new Error(`${mod.id} conflicts with Dia Mod ${id}`);
      }
    }
  }
  return mods;
}

function changedOverrides(mods, state, id, enabled) {
  const overrides = { ...(state?.overrides ?? {}), [id]: enabled };
  const selected = mods.find((mod) => mod.id === id);
  if (enabled) {
    for (const dependency of selected.requires ?? []) overrides[dependency] = true;
    for (const conflict of new Set([
      ...(selected.conflicts ?? []),
      ...(selected.replaces ?? []),
    ])) overrides[conflict] = false;
    for (const mod of mods) {
      if ((mod.conflicts ?? []).includes(id) || (mod.replaces ?? []).includes(id)) {
        overrides[mod.id] = false;
      }
    }
  } else {
    for (const replaced of selected.replaces ?? []) overrides[replaced] = true;
  }
  return overrides;
}

function printTable(mods, statePath) {
  process.stdout.write(`Dia Mods (${statePath})\n\n`);
  const width = Math.max(...mods.map((mod) => mod.id.length));
  for (const mod of mods) {
    const marker = mod.enabled ? "on " : "off";
    const suffix = mod.required ? " · required safety/core" :
      mod.rebuildOnChange ? " · rebuild after changes" : " · restart after changes";
    process.stdout.write(`${marker}  ${mod.id.padEnd(width)}  ${mod.label}${suffix}\n`);
    process.stdout.write(`${" ".repeat(width + 7)}${mod.description}\n`);
  }
}

const { command, profile, json, scope, app, positional } = parseArguments(process.argv.slice(2));
const manifest = await loadJSON(manifestPath, null);
if (!manifest || !Array.isArray(manifest.mods)) throw new Error("invalid Dia Mods manifest");
if (scope !== null && !manifest.mods.some((mod) => mod.scope.includes(scope))) {
  throw new Error(`unknown Dia Mods scope: ${scope}`);
}
if (app && command !== "resolved") throw new Error("--app is supported only for resolved mods");
if (positional.length > (["enable", "disable"].includes(command) ? 1 : 0)) {
  throw new Error(`unexpected Dia Mods argument: ${positional.at(-1)}`);
}
const statePath = resolve(profile, "Bridge/.state/mods.json");
const legacyStatePath = resolve(profile, "Bridge/.state/modules.json");
const state = await loadJSON(statePath,
  await loadJSON(legacyStatePath, { version: 1, overrides: {} }));
const byID = new Map(manifest.mods.map((mod) => [mod.id, mod]));

if (["enable", "disable"].includes(command)) {
  const id = positional[0];
  const mod = byID.get(id);
  if (!mod) throw new Error(`unknown Dia Mod: ${id ?? "<missing>"}`);
  if (command === "enable" && mod.availability === "pending-audit") {
    throw new Error(`${mod.label}: ${mod.availabilityReason ?? "Native feature audit is pending"}`);
  }
  if (command === "disable" && mod.required) {
    throw new Error(`${id} is a required safety/core mod and cannot be disabled`);
  }
  const next = {
    version: 1,
    overrides: changedOverrides(
      manifest.mods,
      state,
      id,
      command === "enable",
    ),
  };
  validateResolvedMods(resolveMods(manifest.mods, next));
  await atomicWriteJSON(statePath, next);
  process.stdout.write(
    `${id} is now ${command === "enable" ? "enabled" : "disabled"}. ` +
    `${mod.rebuildOnChange ? "Run './dia-custom build --replace' to apply it." : "Restart Dia Custom to apply it."}\n`,
  );
  process.exit(0);
}

let activeMods = resolveMods(manifest.mods, state);
if (app) {
  const report = await loadJSON(resolve(profile, "Bridge/.state/compatibility.json"), null);
  const build = execFileSync("/usr/libexec/PlistBuddy", [
    "-c", "Print :CFBundleVersion", resolve(app, "Contents/Info.plist"),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (report?.build === build && Array.isArray(report.perMod)) {
    const unavailable = new Set(report.perMod.filter((mod) => mod.compatible === false).map((mod) => mod.id));
    activeMods = activeMods.map((mod) => {
      if (!mod.enabled || !unavailable.has(mod.id)) return mod;
      if (mod.required) throw new Error(`${mod.id} is a required mod unavailable for Dia build ${build}`);
      return { ...mod, enabled: false, source: "compatibility" };
    });
  }
}
const resolved = validateResolvedMods(activeMods)
  .filter((mod) => scope === null || mod.scope.includes(scope));
if (command === "resolved") {
  process.stdout.write(`${resolved.filter((mod) => mod.enabled).map((mod) => mod.id).join(",")}\n`);
} else if (command === "list") {
  if (json) {
    process.stdout.write(`${JSON.stringify({ version: 1, statePath, mods: resolved }, null, 2)}\n`);
  } else {
    printTable(resolved, statePath);
  }
} else {
  throw new Error("usage: ./dia-custom mods [list [--json]|enable <id>|disable <id>]");
}
