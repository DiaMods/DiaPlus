#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const checkOnly = process.argv[2] === "--check";
const appArgument = process.argv[checkOnly ? 3 : 2];
const app = resolve(appArgument ?? "");
if (!appArgument) {
  throw new Error("usage: patch-report-upload.js [--check] /path/to/Dia Custom.app");
}
if (!checkOnly && (basename(dirname(app)) !== "work" || !basename(app).startsWith("Dia Custom"))) {
  throw new Error(`refusing to patch a non-clone app: ${app}`);
}

const executable = resolve(app, "Contents/MacOS/Dia");
const binary = await readFile(executable);
const imageBase = 0x100000000n;

function signExtend(value, bits) {
  const sign = 1n << BigInt(bits - 1);
  return (value ^ sign) - sign;
}

function branchTarget(offset, instruction, bits, shift) {
  const immediate = BigInt((instruction >>> shift) & ((1 << bits) - 1));
  return Number(BigInt(offset) + (signExtend(immediate, bits) << 2n));
}

function isConditionalZeroBranch(instruction) {
  return ((instruction & 0x7e000000) >>> 0) === 0x34000000;
}

function conditionalZeroBranchTarget(offset, instruction) {
  return branchTarget(offset, instruction, 19, 5);
}

function isUnconditionalBranch(instruction) {
  return ((instruction & 0x7c000000) >>> 0) === 0x14000000;
}

function unconditionalBranchTarget(offset, instruction) {
  const immediate = BigInt(instruction & 0x03ffffff);
  return Number(BigInt(offset) + (signExtend(immediate, 26) << 2n));
}

function encodeUnconditionalBranch(offset, target) {
  const delta = target - offset;
  if (delta % 4 !== 0 || delta < -(1 << 27) || delta >= (1 << 27)) {
    throw new Error("native Report patch target is outside the ARM64 branch range");
  }
  return (0x14000000 | ((delta >> 2) & 0x03ffffff)) >>> 0;
}

function adrpPage(offset, instruction) {
  const immediateLow = BigInt((instruction >>> 29) & 0x3);
  const immediateHigh = BigInt((instruction >>> 5) & 0x7ffff);
  const delta = signExtend((immediateHigh << 2n) | immediateLow, 21) << 12n;
  const address = imageBase + BigInt(offset);
  return (address & ~0xfffn) + delta;
}

function enumConstantAddress(offset, adrp, load) {
  if (((adrp & 0x9f000000) >>> 0) !== 0x90000000 || (adrp & 0x1f) !== 8) {
    return null;
  }
  if (((load & 0xffc00000) >>> 0) !== 0x3dc00000 ||
      ((load >>> 5) & 0x1f) !== 8 || (load & 0x1f) !== 0) {
    return null;
  }
  const immediate = BigInt((load >>> 10) & 0xfff) * 16n;
  return adrpPage(offset, adrp) + immediate;
}

function isInvalidSourcePathConstant(address) {
  const offset = Number(address - imageBase);
  return offset >= 0 && offset + 16 <= binary.length &&
    binary.readBigUInt64LE(offset) === 0n &&
    binary.readBigUInt64LE(offset + 8) === 1n;
}

// UploadArtifactFunctionCall asks an injected ArtifactUtilities object whether
// site_root belongs to an official Dia agent sandbox. That registry is empty
// for a separately bundled/profiled clone, so valid clone-local Reports are
// rejected. The localhost bridge independently realpath-checks the exact
// active-context work/artifacts shape, entry file, symlinks, file count, size,
// and outbound URLs.
// This patch skips only that duplicate native registry result and leaves the
// folder-name validation and native Reports-library ingestion intact.
const matches = [];
for (let constantLoad = 0; constantLoad + 12 <= binary.length; constantLoad += 4) {
  const adrp = binary.readUInt32LE(constantLoad);
  const load = binary.readUInt32LE(constantLoad + 4);
  const store = binary.readUInt32LE(constantLoad + 8);
  const address = enumConstantAddress(constantLoad, adrp, load);
  if (address === null || store !== 0x3d800020 || !isInvalidSourcePathConstant(address)) {
    continue;
  }

  const errorStart = constantLoad - 0x28;
  const successBranchOffset = errorStart - 4;
  if (errorStart < 64) continue;
  const successBranch = binary.readUInt32LE(successBranchOffset);
  if (!isConditionalZeroBranch(successBranch)) continue;
  const successTarget = conditionalZeroBranchTarget(successBranchOffset, successBranch);
  if (successTarget <= constantLoad || successTarget > constantLoad + 0x200) continue;

  for (let offset = errorStart - 0x80; offset < errorStart; offset += 4) {
    const instruction = binary.readUInt32LE(offset);
    const previous = offset >= 4 ? binary.readUInt32LE(offset - 4) : 0;
    // The validator result is an optional value loaded from the async frame;
    // the branch immediately follows that load in Dia 1.45 and 1.46.
    const followsFrameLoad = ((previous & 0xffc003ff) >>> 0) === 0xf94002c8;
    const unpatched = isConditionalZeroBranch(instruction) &&
      conditionalZeroBranchTarget(offset, instruction) === errorStart;
    const patched = isUnconditionalBranch(instruction) &&
      unconditionalBranchTarget(offset, instruction) === successTarget;
    if (followsFrameLoad && (unpatched || patched)) {
      matches.push({ offset, successTarget, patched });
    }
  }
}

if (matches.length !== 1) {
  throw new Error(`expected one audited native Report validator, found ${matches.length}`);
}

const match = matches[0];
if (match.patched) {
  process.stdout.write(checkOnly
    ? "Dia native Report validator layout is compatible and already patched.\n"
    : "Dia Custom native Report upload patch is already applied.\n");
  process.exit(0);
}

if (checkOnly) {
  process.stdout.write("Dia native Report validator layout is compatible.\n");
  process.exit(0);
}

binary.writeUInt32LE(
  encodeUnconditionalBranch(match.offset, match.successTarget),
  match.offset,
);
await writeFile(executable, binary);
process.stdout.write(
  `Patched clone-local native Report validation at file offset 0x${match.offset.toString(16)}.\n`,
);
