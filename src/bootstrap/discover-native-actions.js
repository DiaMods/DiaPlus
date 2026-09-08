#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [file, build, mode = "--json"] = process.argv.slice(2);
if (!file || !/^[0-9]{1,12}$/.test(build ?? "") || !["--json", "--header"].includes(mode)) {
  throw new Error("usage: discover-native-actions.js DIA_EXECUTABLE BUILD [--json|--header]");
}
const bytes = readFileSync(file);
if (bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error("native actions require ARM64 Mach-O");
let functions;
let text;
let base;
let commandOffset = 32;
for (let index = 0; index < bytes.readUInt32LE(16); index += 1) {
  const command = bytes.readUInt32LE(commandOffset);
  const size = bytes.readUInt32LE(commandOffset + 4);
  if (size < 8 || commandOffset + size > bytes.length) throw new Error("invalid Mach-O commands");
  if (command === 0x26) functions = {
    offset: bytes.readUInt32LE(commandOffset + 8), size: bytes.readUInt32LE(commandOffset + 12),
  };
  if (command === 0x19 && bytes.subarray(commandOffset + 8, commandOffset + 14).toString() === "__TEXT") {
    base = Number(bytes.readBigUInt64LE(commandOffset + 24));
    if (bytes.readBigUInt64LE(commandOffset + 40) !== 0n) throw new Error("unexpected __TEXT file mapping");
    for (let section = 0; section < bytes.readUInt32LE(commandOffset + 64); section += 1) {
      const offset = commandOffset + 72 + section * 80;
      if (bytes.subarray(offset, offset + 7).toString() === "__text\0") text = {
        offset: bytes.readUInt32LE(offset + 48), size: Number(bytes.readBigUInt64LE(offset + 40)),
      };
    }
  }
  commandOffset += size;
}
if (!functions || !text || !base) throw new Error("missing native function boundaries");
const starts = [];
let address = 0;
let delta = 0;
let shift = 0;
for (const byte of bytes.subarray(functions.offset, functions.offset + functions.size)) {
  delta += (byte & 127) * 2 ** shift;
  if (byte & 128) { shift += 7; continue; }
  if (delta === 0) break;
  address += delta;
  starts.push(address);
  delta = 0;
  shift = 0;
}
function enclosingFunction(offset) {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (starts[middle] <= offset) lo = middle + 1;
    else hi = middle;
  }
  return starts[lo - 1];
}
const markers = [
  "openOrGenerateCliaReport()",
  "Clia morning brief shortcut: generating report",
  "Clia morning brief shortcut: opening existing report",
];
const targets = markers.map((marker) => {
  const needle = Buffer.from(`${marker}\0`);
  const offset = bytes.indexOf(needle);
  if (offset < 0 || bytes.indexOf(needle, offset + 1) >= 0) {
    throw new Error(`native Morning Brief diagnostic changed: ${marker}`);
  }
  return base + offset;
});
const matches = targets.map(() => new Set());
for (let offset = text.offset; offset + 8 <= text.offset + text.size; offset += 4) {
  const adrp = bytes.readUInt32LE(offset);
  const add = bytes.readUInt32LE(offset + 4);
  if (((adrp & 0x9f000000) >>> 0) !== 0x90000000 ||
      ((add & 0xffc00000) >>> 0) !== 0x91000000 ||
      (adrp & 31) !== ((add >>> 5) & 31)) continue;
  let immediate = ((adrp >>> 5) & 0x7ffff) * 4 + ((adrp >>> 29) & 3);
  if (immediate & 0x100000) immediate -= 0x200000;
  const target = Math.floor((base + offset) / 4096) * 4096 + immediate * 4096 + ((add >>> 10) & 4095);
  const index = targets.indexOf(target);
  if (index >= 0) matches[index].add(enclosingFunction(offset));
}
const candidates = [...matches[0]].filter((offset) => matches.every((set) => set.has(offset)));
if (candidates.length !== 1) throw new Error(`native Morning Brief entrypoint is ambiguous (${candidates.length})`);
const offset = candidates[0];
// Synchronous zero-argument WindowController Swift method. Its only input is
// self in x20; changing this prologue invalidates the private ABI contract.
const signature = [0xa9ba6ffc, 0xa90167fa, 0xa9025ff8, 0xa90357f6, 0xa9044ff4,
  0xa9057bfd, 0x910143fd, 0xd105c3ff, 0x910003f3, 0xd2800000];
if (!signature.every((word, index) => bytes.readUInt32LE(offset + index * 4) === word)) {
  throw new Error("native Morning Brief synchronous method ABI changed");
}
const result = { build, morningBriefOffset: offset, morningBriefSignature: signature };
if (mode === "--header") {
  process.stdout.write(`#define DIA_CUSTOM_NATIVE_ACTION_BUILD "${build}"\n` +
    `#define DIA_CUSTOM_MORNING_BRIEF_OFFSET 0x${offset.toString(16)}\n` +
    `static const uint32_t dia_custom_morning_brief_signature[] = {${signature.map((v) => `0x${v.toString(16)}`).join(",")}};\n`);
} else process.stdout.write(`${JSON.stringify(result)}\n`);
