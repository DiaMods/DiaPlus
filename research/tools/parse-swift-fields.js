#!/usr/bin/env node

import { readFileSync } from "node:fs";

const binaryPath = process.argv[2];
const query = process.argv[3]?.toLowerCase() ?? "";
if (!binaryPath) {
  process.stderr.write("usage: node parse-swift-fields.js <Mach-O> [query]\n");
  process.exit(2);
}

const data = readFileSync(binaryPath);
const machOMagic64 = 0xfeedfacf;

function fixedName(offset, length = 16) {
  const bytes = data.subarray(offset, offset + length);
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero === -1 ? bytes.length : zero).toString("utf8");
}

function section(namedSection) {
  if (data.readUInt32LE(0) !== machOMagic64) {
    throw new Error("parse-swift-fields currently requires a thin little-endian 64-bit Mach-O");
  }
  const commandCount = data.readUInt32LE(16);
  let commandOffset = 32;
  for (let commandIndex = 0; commandIndex < commandCount; commandIndex += 1) {
    const command = data.readUInt32LE(commandOffset);
    const commandSize = data.readUInt32LE(commandOffset + 4);
    if (commandSize < 8 || commandOffset + commandSize > data.length) break;
    if (command === 0x19) {
      const sectionCount = data.readUInt32LE(commandOffset + 64);
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
        const sectionOffset = commandOffset + 72 + sectionIndex * 80;
        if (sectionOffset + 80 > commandOffset + commandSize) break;
        if (fixedName(sectionOffset) !== namedSection) continue;
        const fileOffset = data.readUInt32LE(sectionOffset + 48);
        const size = Number(data.readBigUInt64LE(sectionOffset + 40));
        if (fileOffset + size > data.length) throw new Error(`${namedSection} exceeds the file`);
        return { fileOffset, size };
      }
    }
    commandOffset += commandSize;
  }
  throw new Error(`${namedSection} was not found in ${binaryPath}`);
}

const swiftFields = section("__swift5_fieldmd");
const sectionOffset = swiftFields.fileOffset;
const sectionEnd = sectionOffset + swiftFields.size;
const filterStart = process.env.START_HEX ? Number.parseInt(process.env.START_HEX, 16) : sectionOffset;
const filterEnd = process.env.END_HEX ? Number.parseInt(process.env.END_HEX, 16) : sectionEnd;

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

function relativeTarget(fieldOffset) {
  return fieldOffset + data.readInt32LE(fieldOffset);
}

function cString(offset, maxLength = 512) {
  if (offset < 0 || offset >= data.length) return "<out-of-range>";
  let end = offset;
  while (end < data.length && end - offset < maxLength && data[end] !== 0) end += 1;
  return data.subarray(offset, end).toString("utf8");
}

function escapedBytes(offset, maxLength = 192) {
  if (offset < 0 || offset >= data.length) return "<out-of-range>";
  const result = [];
  for (let index = offset; index < data.length && index - offset < maxLength; index += 1) {
    const byte = data[index];
    if (byte === 0) break;
    result.push(byte >= 0x20 && byte <= 0x7e
      ? String.fromCharCode(byte)
      : `\\x${byte.toString(16).padStart(2, "0")}`);
  }
  return result.join("");
}

for (let offset = sectionOffset; offset + 16 <= sectionEnd;) {
  const recordSize = data.readUInt16LE(offset + 10);
  const fieldCount = data.readUInt32LE(offset + 12);
  if (recordSize < 12 || recordSize > 64 || fieldCount > 10000) break;

  const typeOffset = relativeTarget(offset);
  const typeName = escapedBytes(typeOffset);
  const fields = [];
  for (let index = 0; index < fieldCount; index += 1) {
    const recordOffset = offset + 16 + index * recordSize;
    if (recordOffset + 12 > sectionEnd) break;
    fields.push({
      flags: data.readUInt32LE(recordOffset),
      type: escapedBytes(relativeTarget(recordOffset + 4)),
      name: cString(relativeTarget(recordOffset + 8)),
    });
  }

  const searchable = `${typeName} ${fields.map((field) => `${field.name} ${field.type}`).join(" ")}`.toLowerCase();
  if (offset >= filterStart && offset < filterEnd && (!query || searchable.includes(query))) {
    process.stdout.write(`${JSON.stringify({ offset: `0x${offset.toString(16)}`, typeName, fields })}\n`);
  }

  offset += 16 + fieldCount * recordSize;
}
