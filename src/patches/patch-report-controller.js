#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPatchableCustomApp } from "./custom-app-guard.js";

const checkOnly = process.argv[2] === "--check";
const appArgument = process.argv[checkOnly ? 3 : 2];
const app = resolve(appArgument ?? "");
if (!appArgument) {
  throw new Error(
    "usage: patch-report-controller.js [--check] /path/to/Dia Custom.app",
  );
}
if (!checkOnly) assertPatchableCustomApp(app);

const executable = resolve(app, "Contents/MacOS/Dia");
const binary = await readFile(executable);
const nop = 0xd503201f;

function isLoadByteW8FromX22(instruction) {
  return ((instruction & 0xffc003ff) >>> 0) === 0x394002c8;
}

function isLoadX0FromX22(instruction) {
  return ((instruction & 0xffc003ff) >>> 0) === 0xf94002c0;
}

function isBranchLink(instruction) {
  return ((instruction & 0xfc000000) >>> 0) === 0x94000000;
}

function branchTarget(offset, instruction) {
  let immediate = instruction & 0x03ffffff;
  if ((immediate & 0x02000000) !== 0) immediate -= 0x04000000;
  return offset + immediate * 4;
}

function instructionMask(instruction) {
  if (((instruction & 0xfc000000) >>> 0) === 0x94000000) return 0xfc000000;
  if (((instruction & 0x9f000000) >>> 0) === 0x90000000) return 0x9f00001f;
  if (((instruction & 0x3b000000) >>> 0) === 0x39000000) return 0xffc003ff;
  return 0xffffffff;
}

const reportSetupPrefixes = [
  [
    0xd107c3ff, 0xa9196ffc, 0xa91a67fa, 0xa91b5ff8,
    0xa91c57f6, 0xa91d4ff4, 0xa91e7bfd, 0x910783fd,
    0xaa1403f3, 0xf9400296, 0xa90103f4, 0xd2800000,
  ],
  [
    // Dia 1.50 kept the same Reports setup contract with a smaller frame.
    0xd10483ff, 0xa90c6ffc, 0xa90d67fa, 0xa90e5ff8,
    0xa90f57f6, 0xa9104ff4, 0xa9117bfd, 0x910443fd,
    0xaa1403f3, 0xf9400296, 0xa90103f4, 0xd2800000,
  ],
];

// 1.54 retains the same setup contract but returns early when the native
// controller already exists. Guard this full prefix exactly, including its
// field offset and branch, so the new idempotency check stays intact.
const idempotentSetupPrefix = [
  0xd10483ff, 0xa90c6ffc, 0xa90d67fa, 0xa90e5ff8,
  0xa90f57f6, 0xa9104ff4, 0xa9117bfd, 0x910443fd,
  0xf9466a88, 0xb5001528, 0xaa1403f3, 0xf9400296,
  0xa90103f4, 0xd2800000,
];
function hasReportSetupPrefix(offset) {
  if (offset >= 0 && offset + idempotentSetupPrefix.length * 4 <= binary.length &&
      [idempotentSetupPrefix, idempotentSetupPrefix.map((word, i) => i === 8 ? 0xf9468688 : word)]
        .some(prefix => prefix.every((word, i) => binary.readUInt32LE(offset + i * 4) === word))) return true;
  return reportSetupPrefixes.some((prefix) => offset >= 0 &&
    offset + prefix.length * 4 <= binary.length && prefix.every((expected, index) => {
    const actual = binary.readUInt32LE(offset + index * 4);
    const mask = instructionMask(expected);
    return ((actual & mask) >>> 0) === ((expected & mask) >>> 0);
    }));
}

// BrowserContextDataController receives an authenticated-capability boolean
// before selecting its native Reports setup or teardown continuation. The
// anonymous clone has every local dependency needed by ArtifactsDataController
// but cannot acquire that server-derived capability, leaving the controller
// nil and making upload_artifact return `notAvailable`. Keep the native setup
// path enabled in the clone; Report sharing/sync remains separately disabled.
//
// Locate the guarded async continuation structurally so future Dia builds fail
// closed if the implementation changes instead of patching a stale offset.
const matches = [];
for (let offset = 0; offset + 28 <= binary.length; offset += 4) {
  const loadCapability = binary.readUInt32LE(offset);
  const compareEnabled = binary.readUInt32LE(offset + 4);
  const conditionalTeardown = binary.readUInt32LE(offset + 8);
  const loadController = binary.readUInt32LE(offset + 12);
  const setupCall = binary.readUInt32LE(offset + 16);
  const skipTeardown = binary.readUInt32LE(offset + 20);
  const teardownCall = binary.readUInt32LE(offset + 24);
  const patched = conditionalTeardown === nop;
  const unpatched = conditionalTeardown === 0x54000081; // b.ne +0x10
  const setupTarget = isBranchLink(setupCall)
    ? branchTarget(offset + 16, setupCall)
    : -1;
  if (isLoadByteW8FromX22(loadCapability) &&
      compareEnabled === 0x7100051f && // cmp w8, #1
      (unpatched || patched) &&
      isLoadX0FromX22(loadController) &&
      isBranchLink(setupCall) &&
      hasReportSetupPrefix(setupTarget) &&
      skipTeardown === 0x14000002 && // b +0x8
      isBranchLink(teardownCall)) {
    matches.push({ offset: offset + 8, setupTarget, patched });
  }
}

if (matches.length !== 1) {
  throw new Error(
    `expected one audited native Reports capability gate, found ${matches.length}`,
  );
}

const match = matches[0];
const detail = `gate 0x${match.offset.toString(16)}, setup 0x${match.setupTarget.toString(16)}`;
if (match.patched) {
  process.stdout.write(checkOnly
    ? `Dia native Reports controller ${detail} is compatible and already patched.\n`
    : `Dia Custom native Reports controller ${detail} is already applied.\n`);
  process.exit(0);
}

if (checkOnly) {
  process.stdout.write(
    `Dia native Reports controller ${detail} is compatible.\n`,
  );
  process.exit(0);
}

binary.writeUInt32LE(nop, match.offset);
await writeFile(executable, binary);
process.stdout.write(
  `Enabled the clone-local native Reports controller (${detail}).\n`,
);
