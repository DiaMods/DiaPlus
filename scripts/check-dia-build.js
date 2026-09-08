#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const buildsPath = resolve(projectDirectory, "src/config/supported-dia-builds.json");
const modsPath = resolve(projectDirectory, "bridge/config/dia-mods.json");

const args = process.argv.slice(2);
const json = args.includes("--json");
const allowStructural = args.includes("--allow-structural");
const requirePatched = args.includes("--require-patched");
const modsIndex = args.includes("--mods") ? args.indexOf("--mods") : args.indexOf("--modules");
const selectedMods = modsIndex >= 0
  ? new Set((args[modsIndex + 1] ?? "").split(",").filter(Boolean))
  : null;
const app = args.find((value, index) =>
  !value.startsWith("--") && (modsIndex < 0 || index !== modsIndex + 1));
if (!app) throw new Error("usage: check-dia-build.js /path/to/Dia.app [--mods comma,list] [--json]");

const build = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleVersion", resolve(app, "Contents/Info.plist")],
  { encoding: "utf8" },
).trim();
const [buildManifest, modManifest] = await Promise.all([
  readFile(buildsPath, "utf8").then(JSON.parse),
  readFile(modsPath, "utf8").then(JSON.parse),
]);
const record = buildManifest.builds?.[build];

const knownMods = new Set(modManifest.mods.map((mod) => mod.id));
const supportedMods = new Set(record?.mods ?? record?.modules ?? []);
const requested = selectedMods ?? new Set(
  modManifest.mods.filter((mod) => mod.defaultEnabled !== false).map((mod) => mod.id),
);
const unknown = [...requested].filter((id) => !knownMods.has(id));
if (unknown.length > 0) throw new Error(`unknown Dia Mods: ${unknown.join(", ")}`);
const unsupported = [...requested].filter((id) =>
  record?.status !== "audited" || !supportedMods.has(id));
if (unsupported.length > 0) {
  if (!allowStructural) {
    throw new Error(record?.status === "audited"
      ? `Dia build ${build} has not been audited for: ${unsupported.join(", ")}`
      : `Dia build ${build} is not audited; the existing Dia Custom app was left untouched`);
  }
}
const structural = JSON.parse(execFileSync(process.execPath, [
    resolve(scriptDirectory, "compatibility.js"),
    app,
    "--mods", [...requested].join(","),
    "--json",
    ...(requirePatched ? ["--require-patched"] : []),
  ], { encoding: "utf8" }));
const failures = structural.perMod.filter((mod) => !mod.compatible);
if (failures.length > 0) {
  throw new Error(
    `Dia build ${build} is incompatible with: ${failures.map((mod) => `${mod.id} (${mod.reason})`).join(", ")}`,
  );
}
if (requested.has("dia-import")) {
  const arcCore = await readFile(resolve(
    app,
    "Contents/Frameworks/ArcCore.framework/Versions/A/ArcCore",
  ));
  const original = Buffer.from("Application Support/Arc/User Data");
  const patched = Buffer.from("Application Support/DiaImport");
  if (!arcCore.includes(original) && !arcCore.includes(patched)) {
    throw new Error(
      `Dia build ${build} is missing the audited native browser importer path`,
    );
  }
}

const result = {
  build,
  version: structural?.version ?? record?.version ?? null,
  status: unsupported.length > 0 ? "structurally-compatible" : record?.status ?? "unknown",
  mods: [...requested],
  notes: record?.notes ?? "",
  ...(structural ? { compatibility: structural.perMod } : {}),
};
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(unsupported.length > 0
  ? `Dia build ${build} passed structural validation for ${requested.size} enabled Dia Mods.\n`
  : `Dia build ${build} is audited and structurally verified for ${requested.size} enabled Dia Mods.\n`);
