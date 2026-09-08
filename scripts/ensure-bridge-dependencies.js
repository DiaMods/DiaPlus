#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function ensureBridgeDependencies(directory, {
  install = () => execFileSync("npm", ["ci", "--omit=dev"], { cwd: directory, stdio: "inherit" }),
} = {}) {
  const packageText = readFileSync(join(directory, "package.json"), "utf8");
  const lockText = readFileSync(join(directory, "package-lock.json"), "utf8");
  const manifest = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    1, process.platform, process.arch, process.versions.modules, packageText, lockText,
  ])).digest("hex");
  const marker = join(directory, "node_modules/.dia-custom-dependencies.sha256");
  const packagesMatch = () => Object.keys(manifest.dependencies ?? {}).every((name) => {
    try {
      const installed = JSON.parse(readFileSync(join(directory, "node_modules", name, "package.json"), "utf8"));
      const expectedVersion = lock.packages?.[`node_modules/${name}`]?.version ?? lock.dependencies?.[name]?.version;
      return typeof expectedVersion === "string" && installed.version === expectedVersion;
    } catch { return false; }
  });
  let recorded = "";
  try { recorded = readFileSync(marker, "utf8").trim(); } catch { /* first bundle */ }
  if (recorded === fingerprint && packagesMatch()) return false;

  // npm ci can remove node_modules before failing. Never leave an earlier
  // successful marker available for a later build to mistake for freshness.
  rmSync(marker, { force: true });
  install();
  if (!packagesMatch()) throw new Error("installed bridge dependencies do not match package-lock.json");
  const temporary = `${marker}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${fingerprint}\n`, { mode: 0o600 });
    renameSync(temporary, marker);
  } finally {
    rmSync(temporary, { force: true });
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("usage: ensure-bridge-dependencies.js BRIDGE_DIRECTORY");
  ensureBridgeDependencies(resolve(process.argv[2]));
}
