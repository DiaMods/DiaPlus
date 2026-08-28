#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const checkOnly = process.argv[2] === "--check";
const appArgument = process.argv[checkOnly ? 3 : 2];
if (!appArgument) {
  throw new Error("usage: patch-dia-import.js [--check] /path/to/Dia Custom.app");
}
const app = resolve(appArgument);
if (!checkOnly &&
    (basename(dirname(app)) !== "work" || !basename(app).startsWith("Dia Custom"))) {
  throw new Error(`refusing to patch a non-clone app: ${app}`);
}

const executable = resolve(
  app,
  "Contents/Frameworks/ArcCore.framework/Versions/A/ArcCore",
);
const original = Buffer.from("Application Support/Arc/User Data\0");
const replacementText = Buffer.from("Application Support/DiaImport");
const replacement = Buffer.alloc(original.length);
replacementText.copy(replacement);

const binary = await readFile(executable);
function offsetsOf(needle) {
  const offsets = [];
  for (let offset = binary.indexOf(needle); offset >= 0;
       offset = binary.indexOf(needle, offset + needle.length)) {
    offsets.push(offset);
  }
  return offsets;
}

const originalOffsets = offsetsOf(original);
const replacementOffsets = offsetsOf(replacement);
if (originalOffsets.length === 0 && replacementOffsets.length === 1) {
  process.stdout.write(checkOnly
    ? "Dia native importer path is compatible and already patched.\n"
    : "Dia Custom native official-Dia importer is already applied.\n");
  process.exit(0);
}
if (originalOffsets.length !== 1 || replacementOffsets.length !== 0) {
  throw new Error(
    `expected one audited Arc importer path, found ${originalOffsets.length} original and ${replacementOffsets.length} patched`,
  );
}
if (checkOnly) {
  process.stdout.write("Dia native importer path is compatible.\n");
  process.exit(0);
}

replacement.copy(binary, originalOffsets[0]);
await writeFile(executable, binary);
process.stdout.write(
  "Redirected Dia Custom's native Arc importer to the sanitized official-Dia staging area.\n",
);
