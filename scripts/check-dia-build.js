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
if (!record || record.status !== "audited") {
  throw new Error(
    `Dia build ${build} is not audited; the existing Dia Custom app was left untouched`,
  );
}

const knownMods = new Set(modManifest.mods.map((mod) => mod.id));
const supportedMods = new Set(record.mods ?? record.modules ?? []);
const requested = selectedMods ?? new Set(
  modManifest.mods.filter((mod) => mod.defaultEnabled !== false).map((mod) => mod.id),
);
const unknown = [...requested].filter((id) => !knownMods.has(id));
if (unknown.length > 0) throw new Error(`unknown Dia Mods: ${unknown.join(", ")}`);
const unsupported = [...requested].filter((id) => !supportedMods.has(id));
if (unsupported.length > 0) {
  throw new Error(`Dia build ${build} has not been audited for: ${unsupported.join(", ")}`);
}
if (requested.has("official-dia-sync")) {
  const executable = await readFile(resolve(app, "Contents/MacOS/Dia"));
  const requiredSyncSurface = [
    "https://dia-sync.diabrowser.engineering",
    "X-Dia-Sync-Token",
    "sync-encryption-enabled",
    "Aes256Gcm",
    "SyncClientInfo",
    "BookmarksSyncAdapter",
    "ProfilesSyncAdapter",
    "SettingsSyncAdapter",
    "TabTreeSyncAdapter",
  ];
  const missing = requiredSyncSurface.filter((value) =>
    !executable.includes(Buffer.from(value)));
  if (missing.length > 0) {
    throw new Error(
      `Dia build ${build} is missing audited native Sync components: ${missing.join(", ")}`,
    );
  }
}

const result = {
  build,
  version: record.version ?? null,
  status: record.status,
    mods: [...requested],
  notes: record.notes ?? "",
};
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(`Dia build ${build} is audited for ${requested.size} enabled Dia Mods.\n`);
