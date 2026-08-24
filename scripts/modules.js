#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const manifestPath = resolve(projectDirectory, "src/config/compatibility-modules.json");

function parseArguments(argv) {
  const values = [...argv];
  const command = values.shift() ?? "list";
  let profile = process.env.DIA_CUSTOM_PROFILE ??
    resolve(homedir(), "Library/Application Support/Dia Custom RTTM");
  let json = false;
  let scope = null;
  const positional = [];
  while (values.length > 0) {
    const value = values.shift();
    if (value === "--profile") {
      profile = resolve(values.shift() ?? "");
    } else if (value === "--json") {
      json = true;
    } else if (value === "--scope") {
      scope = values.shift() ?? null;
    } else {
      positional.push(value);
    }
  }
  return { command, profile, json, scope, positional };
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

function exactEnvironmentSelection(modules) {
  const raw = process.env.DIA_CUSTOM_MODULES;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const selected = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
  const known = new Set(modules.map((module) => module.id));
  const unknown = [...selected].filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown DIA_CUSTOM_MODULES: ${unknown.join(", ")}`);
  return selected;
}

function resolveModules(modules, state) {
  const environment = exactEnvironmentSelection(modules);
  return modules.map((module) => {
    const configured = state?.overrides?.[module.id];
    const enabled = module.required || (environment
      ? environment.has(module.id)
      : typeof configured === "boolean"
        ? configured
        : module.defaultEnabled !== false);
    return {
      ...module,
      enabled,
      source: module.required
        ? "required"
        : environment
          ? "environment"
          : typeof configured === "boolean"
            ? "profile"
            : "default",
    };
  });
}

function printTable(modules, statePath) {
  process.stdout.write(`Compatibility modules (${statePath})\n\n`);
  const width = Math.max(...modules.map((module) => module.id.length));
  for (const module of modules) {
    const marker = module.enabled ? "on " : "off";
    const suffix = module.required ? " · required safety/core" :
      module.rebuildOnChange ? " · rebuild after changes" : " · restart after changes";
    process.stdout.write(`${marker}  ${module.id.padEnd(width)}  ${module.label}${suffix}\n`);
    process.stdout.write(`${" ".repeat(width + 7)}${module.description}\n`);
  }
}

const { command, profile, json, scope, positional } = parseArguments(process.argv.slice(2));
const manifest = await loadJSON(manifestPath, null);
if (!manifest || !Array.isArray(manifest.modules)) throw new Error("invalid module manifest");
const statePath = resolve(profile, "Bridge/.state/modules.json");
const state = await loadJSON(statePath, { version: 1, overrides: {} });
const byID = new Map(manifest.modules.map((module) => [module.id, module]));

if (["enable", "disable"].includes(command)) {
  const id = positional[0];
  const module = byID.get(id);
  if (!module) throw new Error(`unknown compatibility module: ${id ?? "<missing>"}`);
  if (command === "disable" && module.required) {
    throw new Error(`${id} is a required safety/core module and cannot be disabled`);
  }
  const next = {
    version: 1,
    overrides: { ...(state.overrides ?? {}), [id]: command === "enable" },
  };
  await atomicWriteJSON(statePath, next);
  process.stdout.write(
    `${id} is now ${command === "enable" ? "enabled" : "disabled"}. ` +
    `${module.rebuildOnChange ? "Run './dia-custom build --replace' to apply it." : "Restart Dia Custom to apply it."}\n`,
  );
  process.exit(0);
}

const resolved = resolveModules(manifest.modules, state)
  .filter((module) => scope === null || module.scope.includes(scope));
if (command === "resolved") {
  process.stdout.write(`${resolved.filter((module) => module.enabled).map((module) => module.id).join(",")}\n`);
} else if (command === "list") {
  if (json) {
    process.stdout.write(`${JSON.stringify({ version: 1, statePath, modules: resolved }, null, 2)}\n`);
  } else {
    printTable(resolved, statePath);
  }
} else {
  throw new Error("usage: ./dia-custom modules [list [--json]|enable <id>|disable <id>]");
}
