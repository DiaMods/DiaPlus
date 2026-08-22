#!/usr/bin/env node

import fs from "node:fs";

const [file, rawTarget] = process.argv.slice(2);
if (!file || !rawTarget) {
  console.error("usage: arm64-xrefs.js <Mach-O> <target-vaddr>");
  process.exit(2);
}

const imageBase = 0x100000000n;
const target = BigInt(rawTarget);
const data = fs.readFileSync(file);
const hits = [];
const loadHits = [];
const branchHits = [];

function signExtend(value, bits) {
  const sign = 1n << BigInt(bits - 1);
  return (value ^ sign) - sign;
}

for (let offset = 0; offset + 24 <= data.length; offset += 4) {
  const instruction = data.readUInt32LE(offset);
  if (((instruction & 0xfc000000) >>> 0) === 0x94000000) {
    const delta = signExtend(BigInt(instruction & 0x03ffffff), 26) << 2n;
    const instructionAddress = imageBase + BigInt(offset);
    if (instructionAddress + delta === target) {
      branchHits.push("0x" + instructionAddress.toString(16));
    }
  }
  if (((instruction & 0x9f000000) >>> 0) !== 0x90000000) {
    continue;
  }

  const destination = instruction & 0x1f;
  const immediateLow = BigInt((instruction >>> 29) & 0x3);
  const immediateHigh = BigInt((instruction >>> 5) & 0x7ffff);
  const pageDelta = signExtend((immediateHigh << 2n) | immediateLow, 21) << 12n;
  const instructionAddress = imageBase + BigInt(offset);
  const page = (instructionAddress & ~0xfffn) + pageDelta;

  for (let distance = 1; distance <= 5; ++distance) {
    const nextOffset = offset + distance * 4;
    const next = data.readUInt32LE(nextOffset);
    if (((next & 0xff000000) >>> 0) !== 0x91000000) {
      const loadKind = (next & 0xffc00000) >>> 0;
      const scale = loadKind === 0xf9400000
        ? 8n
        : loadKind === 0xb9400000
          ? 4n
          : null;
      if (scale !== null && ((next >>> 5) & 0x1f) === destination) {
        const immediate = BigInt((next >>> 10) & 0xfff) * scale;
        if (page + immediate === target) {
          loadHits.push({
            instruction: "0x" + instructionAddress.toString(16),
            load: "0x" + (imageBase + BigInt(nextOffset)).toString(16),
            pageRegister: destination,
            resultRegister: next & 0x1f,
            distance,
            scale: Number(scale),
          });
        }
      }
      continue;
    }
    const addDestination = next & 0x1f;
    const source = (next >>> 5) & 0x1f;
    if (source !== destination) {
      continue;
    }
    const shift = ((next >>> 22) & 1) === 1 ? 12n : 0n;
    const immediate = BigInt((next >>> 10) & 0xfff) << shift;
    if (page + immediate === target) {
      hits.push({
        instruction: "0x" + instructionAddress.toString(16),
        add: "0x" + (imageBase + BigInt(nextOffset)).toString(16),
        pageRegister: destination,
        resultRegister: addDestination,
        distance,
      });
    }
  }
}

console.log(JSON.stringify({
  addressMaterializations: hits,
  loadMaterializations: loadHits,
  branchLinks: branchHits,
}, null, 2));
