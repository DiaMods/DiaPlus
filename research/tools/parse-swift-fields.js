#!/usr/bin/env node

import { readFileSync } from "node:fs";

const binaryPath = process.argv[2];
const query = process.argv[3]?.toLowerCase() ?? "";
if (!binaryPath) {
  process.stderr.write("usage: node parse-swift-fields.js <Mach-O> [query]\n");
  process.exit(2);
}

const data = readFileSync(binaryPath);
const sectionOffset = 0x60afaa0;
const sectionEnd = sectionOffset + 0x11ef60;
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
