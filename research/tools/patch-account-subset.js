#!/usr/bin/env node

// Disposable Dia 87561 diagnosis only. Never use this to install a browser:
// it applies one guarded anonymous-account subpatch to an isolated test app.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [app, variant] = process.argv.slice(2);
if (!app || !["state", "method", "constructor"].includes(variant) ||
    !resolve(app).includes("/.dia-custom-backups/Dia Custom ") ||
    !resolve(app).endsWith(" 87561 Test.app")) {
  throw new Error("usage: patch-account-subset.js /Applications/.dia-custom-backups/Dia\\ Custom\\ ...\\ 87561\\ Test.app state|method|constructor");
}
const path = resolve(app, "Contents/MacOS/Dia");
const data = readFileSync(path);
const patches = {
  state: [[0x2dd504c, "fc6fbaa9fa6701a9", "20008052c0035fd6"]],
  method: [[0x75e6ec, "bd0344b2ffc300d1f5cf00a9fd7b02a9", "c10640f940008052140080d220001fd6"]],
  constructor: [[0x2dbbd08, "bdfeff97", "09938697"]],
};
for (const [offset, before, after] of patches[variant]) {
  if (data.subarray(offset, offset + before.length / 2).toString("hex") !== before) {
    throw new Error(`unexpected Dia 87561 instruction at 0x${offset.toString(16)}`);
  }
  Buffer.from(after, "hex").copy(data, offset);
}
writeFileSync(path, data);
process.stdout.write(`Applied disposable ${variant} diagnostic patch.\n`);
