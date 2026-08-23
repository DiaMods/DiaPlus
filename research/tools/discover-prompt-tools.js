#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [binaryPath, build, outputMode = "--json"] = process.argv.slice(2);
if (!binaryPath || !build || !["--json", "--header"].includes(outputMode)) {
  throw new Error(
    "usage: discover-prompt-tools.js /path/to/Dia BUILD [--json|--header]",
  );
}
if (!/^[0-9]{1,12}$/.test(build)) {
  throw new Error(`unsupported Dia build identifier: ${build}`);
}

const binary = readFileSync(binaryPath);
const machOMagic64 = 0xfeedfacf;
const lcSegment64 = 0x19;
const lcFunctionStarts = 0x26;
if (binary.readUInt32LE(0) !== machOMagic64) {
  throw new Error("Prompt Tools discovery requires a thin little-endian 64-bit Mach-O");
}

function fixedName(offset, length = 16) {
  const value = binary.subarray(offset, offset + length);
  const zero = value.indexOf(0);
  return value.subarray(0, zero === -1 ? value.length : zero).toString("utf8");
}

function machOLayout() {
  const commandCount = binary.readUInt32LE(16);
  let commandOffset = 32;
  let textVMAddress = null;
  let textFileOffset = null;
  let functionDataOffset = null;
  let functionDataSize = null;
  for (let index = 0; index < commandCount; index += 1) {
    const command = binary.readUInt32LE(commandOffset);
    const commandSize = binary.readUInt32LE(commandOffset + 4);
    if (commandSize < 8 || commandOffset + commandSize > binary.length) {
      throw new Error("invalid Mach-O load command while locating Prompt Tools");
    }
    if (command === lcSegment64 && fixedName(commandOffset + 8) === "__TEXT") {
      textVMAddress = binary.readBigUInt64LE(commandOffset + 24);
      textFileOffset = binary.readBigUInt64LE(commandOffset + 40);
    } else if (command === lcFunctionStarts) {
      functionDataOffset = binary.readUInt32LE(commandOffset + 8);
      functionDataSize = binary.readUInt32LE(commandOffset + 12);
    }
    commandOffset += commandSize;
  }
  if (textVMAddress === null || textFileOffset === null ||
      functionDataOffset === null || functionDataSize === null) {
    throw new Error("Dia Mach-O is missing __TEXT or LC_FUNCTION_STARTS");
  }
  return {
    textVMAddress,
    textFileOffset: Number(textFileOffset),
    functionDataOffset,
    functionDataSize,
  };
}

function readULEB128(state, end) {
  let value = 0n;
  let shift = 0n;
  while (state.offset < end) {
    const byte = binary[state.offset];
    state.offset += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7n;
    if (shift > 63n) throw new Error("invalid LC_FUNCTION_STARTS value");
  }
  throw new Error("truncated LC_FUNCTION_STARTS value");
}

function functionStarts(layout) {
  const end = layout.functionDataOffset + layout.functionDataSize;
  const state = { offset: layout.functionDataOffset };
  let address = layout.textVMAddress;
  const starts = [];
  while (state.offset < end) {
    const delta = readULEB128(state, end);
    if (delta === 0n) break;
    address += delta;
    const imageOffset = Number(address - layout.textVMAddress);
    const fileOffset = layout.textFileOffset + imageOffset;
    starts.push({ fileOffset, imageOffset });
  }
  return starts;
}

function unsigned(value) {
  return value >>> 0;
}

function instructionMask(instruction) {
  const branch = unsigned(instruction & 0xfc000000);
  if (branch === 0x94000000 || branch === 0x14000000) return 0xfc000000;
  if (unsigned(instruction & 0x9f000000) === 0x90000000) return 0x9f00001f;
  if (unsigned(instruction & 0xff000010) === 0x54000000) return 0xff00001f;
  if (unsigned(instruction & 0x7e000000) === 0x34000000) return 0xff00001f;
  if (unsigned(instruction & 0x7e000000) === 0x36000000) return 0xfff8001f;
  // Unsigned-offset loads contain relocated Swift metadata/Objective-C selector
  // offsets. Preserve the operation and registers, but not the 12-bit offset.
  if (unsigned(instruction & 0x3b000000) === 0x39000000) return 0xffc003ff;
  return 0xffffffff;
}

function matchesSignature(fileOffset, signature) {
  if (fileOffset < 0 || fileOffset + signature.length * 4 > binary.length) return false;
  return signature.every((expected, index) => {
    const actual = binary.readUInt32LE(fileOffset + index * 4);
    const mask = instructionMask(expected);
    return unsigned(actual & mask) === unsigned(expected & mask);
  });
}

// These are instruction shapes, not file offsets. Both Dia 1.45 and 1.46 use
// these private Swift entry points; relocated branches, metadata pages, and
// field offsets are masked above. A structural change therefore fails closed.
const allocatingInitializerSignature = [
  0xa9bd57f6, 0xa9014ff4, 0xa9027bfd, 0x910083fd,
  0xaa0203f3, 0xaa0003f5, 0xaa1403e0, 0x52805c01,
  0x528000e2, 0x9436a89c, 0xaa0003f4, 0xaa1503e0,
  0xaa1303e1, 0x940022f1, 0xa9427bfd, 0xa9414ff4,
  0xa8c357f6, 0xd65f03c0,
];

const platformWindowPresenterSignature = [
  0xa9bb67fa, 0xa9015ff8, 0xa90257f6, 0xa9034ff4,
  0xa9047bfd, 0x910103fd, 0xaa1403f3, 0xf000e388,
  0xf940551a, 0xf87a6a94, 0xb4000094, 0xaa1403f5,
  0xaa1403e0, 0x1400001b, 0xa941d414, 0xa942dc16,
  0xf9401c18, 0xd2800000, 0x97dac5d3, 0x9411fe8d,
  0xaa0003f9, 0xaa1403e0, 0x941201d5, 0xaa1503e0,
  0x941201d3, 0xaa1603e0, 0x941201d1, 0xaa1703e0,
  0x941201cf, 0xaa1803e0, 0x941201cd, 0xaa1403e0,
  0xaa1503e1, 0xaa1603e2, 0xaa1703e3, 0xaa1803e4,
  0xaa1903f4, 0x97dac430, 0xd2800015, 0xf87a6a74,
  0xf83a6a60, 0x9411fec8, 0xaa0003f3, 0xaa1503e0,
  0x9411fec5, 0xaa1403e0, 0x9411fec0, 0xf000cae8,
  0xf9411101, 0xaa1303e0, 0x9411feaa, 0xaa1d03fd,
  0x9411fec6, 0xb4000100, 0xf000ca88, 0xf9474101,
  0xaa0003f4, 0xd2800002, 0x9411fea2, 0xaa1403e0,
  0x9411feb2, 0xaa1303e0, 0xa9447bfd, 0xa9434ff4,
  0xa94257f6, 0xa9415ff8, 0xa8c567fa, 0x1411feab,
];

const layout = machOLayout();
const starts = functionStarts(layout);

function locate(signature) {
  return starts
    .filter((start, index) => {
      const next = starts[index + 1];
      return next && next.fileOffset - start.fileOffset === signature.length * 4;
    })
    .filter(({ fileOffset }) => matchesSignature(fileOffset, signature));
}

const initializerMatches = locate(allocatingInitializerSignature);
const presenterMatches = locate(platformWindowPresenterSignature);
if (initializerMatches.length !== 1 || presenterMatches.length !== 1) {
  throw new Error(
    `expected one Prompt Tools initializer and presenter; found ` +
    `${initializerMatches.length} and ${presenterMatches.length}`,
  );
}

const result = {
  build,
  initializerOffset: initializerMatches[0].imageOffset,
  presenterOffset: presenterMatches[0].imageOffset,
};

if (outputMode === "--header") {
  process.stdout.write(`// Generated from Dia build ${build}; do not edit.\n`);
  process.stdout.write("#ifndef DIA_CUSTOM_PROMPT_TOOLS_OFFSETS_H\n");
  process.stdout.write("#define DIA_CUSTOM_PROMPT_TOOLS_OFFSETS_H\n");
  process.stdout.write(`#define DIA_CUSTOM_PROMPT_TOOLS_BUILD \"${build}\"\n`);
  process.stdout.write(
    `#define DIA_CUSTOM_PROMPT_TOOLS_INIT_OFFSET ((uintptr_t)0x${result.initializerOffset.toString(16)})\n`,
  );
  process.stdout.write(
    `#define DIA_CUSTOM_PROMPT_TOOLS_PRESENT_OFFSET ((uintptr_t)0x${result.presenterOffset.toString(16)})\n`,
  );
  process.stdout.write("#endif\n");
} else {
  process.stdout.write(`${JSON.stringify({
    build: result.build,
    initializerOffset: `0x${result.initializerOffset.toString(16)}`,
    presenterOffset: `0x${result.presenterOffset.toString(16)}`,
  })}\n`);
}
