#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const appPath = process.argv[2] ? path.resolve(process.argv[2]) : "";

if (
  path.basename(path.dirname(appPath)) !== "work" ||
  !path.basename(appPath).startsWith("Dia Custom")
) {
  throw new Error(`refusing to patch a non-clone app: ${appPath}`);
}

const executable = path.join(
  appPath,
  "Contents",
  "Frameworks",
  "ArcCore.framework",
  "Versions",
  "A",
  "ArcCore",
);
const source = Buffer.from("Safe Storage");
const replacement = Buffer.from("Custom Store");

if (source.length !== replacement.length) {
  throw new Error("Keychain labels must have identical byte lengths");
}

const data = fs.readFileSync(executable);
let originalCount = 0;
let replacementCount = 0;
for (let offset = 0; offset <= data.length - source.length; ++offset) {
  const candidate = data.subarray(offset, offset + source.length);
  if (candidate.equals(source)) {
    replacement.copy(data, offset);
    originalCount += 1;
    offset += source.length - 1;
  } else if (candidate.equals(replacement)) {
    replacementCount += 1;
    offset += replacement.length - 1;
  }
}

if (originalCount === 0 && replacementCount === 3) {
  console.log("Dia Custom already uses its separate Keychain label");
  process.exit(0);
}
if (originalCount !== 3) {
  throw new Error(`expected three Safe Storage labels, found ${originalCount}`);
}

fs.writeFileSync(executable, data);
console.log("Changed Dia Custom's Keychain service from 'Dia Safe Storage' to 'Dia Custom Store'");
