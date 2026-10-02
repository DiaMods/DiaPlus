#!/usr/bin/env node

// Research aid only: rank likely relocated ARM64 functions by their guarded
// instruction shapes. A match is not evidence that a patch site is safe.
import { readFileSync } from "node:fs";

const [olderPath, newerPath, ...addresses] = process.argv.slice(2);
if (!olderPath || !newerPath || addresses.length === 0) {
  throw new Error("usage: match-native-functions.js old/Dia new/Dia 0xOLD_OFFSET ...");
}

function functionStarts(data) {
  const count = data.readUInt32LE(16);
  let cursor = 32;
  let start = 0;
  let size = 0;
  for (let index = 0; index < count; index += 1) {
    const command = data.readUInt32LE(cursor);
    if (command === 0x26) {
      start = data.readUInt32LE(cursor + 8);
      size = data.readUInt32LE(cursor + 12);
    }
    cursor += data.readUInt32LE(cursor + 4);
  }
  if (!start || !size) throw new Error("missing LC_FUNCTION_STARTS");
  const result = [];
  let offset = 0;
  let value = 0;
  let shift = 0;
  for (let index = start; index < start + size; index += 1) {
    const byte = data[index];
    value |= (byte & 0x7f) << shift;
    if (byte & 0x80) {
      shift += 7;
      continue;
    }
    if (value === 0) break;
    offset += value;
    result.push(offset);
    value = 0;
    shift = 0;
  }
  return result;
}

function normalized(word) {
  const op = word >>> 0;
  if ((op & 0x7c000000) === 0x14000000) return op & 0xfc000000;
  if ((op & 0x9f000000) === 0x90000000) return op & 0x9f00001f;
  if ((op & 0x9f000000) === 0x10000000) return op & 0x9f00001f;
  if ((op & 0xff000010) === 0x54000000) return op & 0xff00001f;
  if ((op & 0x7e000000) === 0x34000000) return op & 0xff00001f;
  if ((op & 0x7e000000) === 0x36000000) return op & 0xfff8001f;
  if ((op & 0x3b000000) === 0x39000000) return op & 0xffc003ff;
  return op;
}

const oldData = readFileSync(olderPath);
const newData = readFileSync(newerPath);
const oldStarts = functionStarts(oldData);
const newStarts = functionStarts(newData);
console.log(`functions: old=${oldStarts.length} new=${newStarts.length}`);
function containing(starts, address) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= address) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

for (const text of addresses) {
  const address = Number(text);
  const oldIndex = containing(oldStarts, address);
  if (oldIndex < 0) throw new Error(`old offset outside function starts: ${text}`);
  const begin = oldStarts[oldIndex];
  const end = oldStarts[oldIndex + 1];
  const length = end - begin;
  const oldWords = [];
  for (let offset = begin; offset < end; offset += 4) {
    oldWords.push(normalized(oldData.readUInt32LE(offset)));
  }
  const ranked = [];
  for (let index = 0; index + 1 < newStarts.length; index += 1) {
    const candidate = newStarts[index];
    const candidateLength = newStarts[index + 1] - candidate;
    if (candidateLength < length * 0.6 || candidateLength > length * 1.5) continue;
    const newCount = candidateLength / 4;
    const count = Math.min(oldWords.length, newCount);
    let score = 0;
    let checked = 0;
    for (let word = 0; word < Math.min(30, count); word += 1) {
      score += Number(oldWords[word] === normalized(newData.readUInt32LE(candidate + word * 4)));
      checked += 1;
    }
    for (let word = 1; word <= Math.min(14, count); word += 1) {
      score += Number(oldWords[oldWords.length - word] === normalized(newData.readUInt32LE(candidate + candidateLength - word * 4)));
      checked += 1;
    }
    if (score >= 8) ranked.push({ offset: candidate, size: candidateLength, score, checked });
  }
  ranked.sort((a, b) => b.score - a.score || Math.abs(a.size - length) - Math.abs(b.size - length));
  const votes = new Map();
  for (let oldWord = 2; oldWord + 3 < oldWords.length; oldWord += 1) {
    const words = [0, 1, 2].map(index => oldData.readUInt32LE(begin + (oldWord + index) * 4));
    if (words.some(word => normalized(word) !== word)) continue;
    const needle = oldData.subarray(begin + oldWord * 4, begin + (oldWord + 3) * 4);
    const hits = [];
    for (let offset = newData.indexOf(needle); offset >= 0;
      offset = newData.indexOf(needle, offset + 1)) {
      hits.push(offset);
      if (hits.length > 1000) break;
    }
    if (hits.length > 1000 || hits.length === 0) continue;
    for (const hit of hits) {
      const index = containing(newStarts, hit);
      if (index < 0) continue;
      const target = newStarts[index];
      votes.set(target, (votes.get(target) ?? 0) + 1 / Math.sqrt(hits.length));
    }
  }
  const voted = [...votes].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([offset, score]) => ({ offset: `0x${offset.toString(16)}`, score }));
  console.log(JSON.stringify({ oldSite: text, oldFunction: `0x${begin.toString(16)}`,
    oldSize: length, oldSiteRelative: address - begin,
    candidates: ranked.slice(0, 8).map(({ offset, size, score, checked }) => ({
      offset: `0x${offset.toString(16)}`, size, score, checked,
    })), ngramCandidates: voted }, null, 2));
}
