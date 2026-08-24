#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const buildsPath = resolve(projectDirectory, "src/config/supported-dia-builds.json");
const modulesPath = resolve(projectDirectory, "src/config/compatibility-modules.json");

const args = process.argv.slice(2);
const json = args.includes("--json");
const modulesIndex = args.indexOf("--modules");
const selectedModules = modulesIndex >= 0
  ? new Set((args[modulesIndex + 1] ?? "").split(",").filter(Boolean))
  : null;
const app = args.find((value, index) =>
  !value.startsWith("--") && (modulesIndex < 0 || index !== modulesIndex + 1));
if (!app) throw new Error("usage: check-dia-build.js /path/to/Dia.app [--modules comma,list] [--json]");

const build = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleVersion", resolve(app, "Contents/Info.plist")],
  { encoding: "utf8" },
).trim();
const [buildManifest, moduleManifest] = await Promise.all([
  readFile(buildsPath, "utf8").then(JSON.parse),
  readFile(modulesPath, "utf8").then(JSON.parse),
]);
const record = buildManifest.builds?.[build];
if (!record || record.status !== "audited") {
  throw new Error(
    `Dia build ${build} is not audited; the existing Dia Custom app was left untouched`,
  );
}

const knownModules = new Set(moduleManifest.modules.map((module) => module.id));
const supportedModules = new Set(record.modules ?? []);
const requested = selectedModules ?? new Set(
  moduleManifest.modules.filter((module) => module.defaultEnabled !== false).map((module) => module.id),
);
const unknown = [...requested].filter((id) => !knownModules.has(id));
if (unknown.length > 0) throw new Error(`unknown compatibility modules: ${unknown.join(", ")}`);
const unsupported = [...requested].filter((id) => !supportedModules.has(id));
if (unsupported.length > 0) {
  throw new Error(`Dia build ${build} has not been audited for: ${unsupported.join(", ")}`);
}

const result = {
  build,
  version: record.version ?? null,
  status: record.status,
  modules: [...requested],
  notes: record.notes ?? "",
};
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(`Dia build ${build} is audited for ${requested.size} enabled compatibility modules.\n`);
