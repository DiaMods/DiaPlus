#!/usr/bin/env node
// Disposable-app experiment only. This is NOT release compatibility approval.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { requireResearchCopy } from './research-copy-guard.js';
const [rootArg, officialArg, ...options] = process.argv.slice(2);
const restore = options.includes('--restore');
const inspect = options.includes('--inspect');
const selected = options.filter(option => !['--restore', '--inspect'].includes(option));
if (!rootArg || !officialArg || !selected.length) throw new Error('usage: patch-native-feature-getters.js RESEARCH_ROOT OFFICIAL_APP MOD_ID...');
const { root, test } = await requireResearchCopy(rootArg);
const target = join(test.app, 'Contents/MacOS/Dia');
execFileSync(process.execPath, [new URL('../../scripts/browser-process-guard.js', import.meta.url).pathname, 'assert-stopped', test.app]);
if (!(await realpath(target)).startsWith((await realpath(root)) + '/')) throw new Error('Target escaped research root');
const source = await readFile(join(resolve(officialArg), 'Contents/MacOS/Dia'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(source) !== '7686865a6a688912df875b738c729f49b246869e3f775f71e93c09af931493f9') throw new Error('Unaudited official executable');
const manifest = JSON.parse(await readFile(new URL('../../bridge/config/dia-mods.json', import.meta.url)));
const allowed = manifest.mods.filter(mod => mod.nativeFeatureFlags?.length);
if (selected.some(id => !allowed.some(mod => mod.id === id))) throw new Error('Unknown experiment');
const prefix = Buffer.from('ff8301d1f44f04a9fd7b05a9fd430191e00702a9e21b00f9', 'hex');
const tail = Buffer.from('a0f35e38fd7b45a9f44f44a9ff830191c0035fd6', 'hex');
const matches = new Map();
for (let start = source.indexOf(prefix); start >= 0; start = source.indexOf(prefix, start + 4)) {
  const returns = [0x84, 0x88].filter(offset => source.subarray(start + offset, start + offset + tail.length).equals(tail));
  if (returns.length !== 1) continue;
  const returnRelative = returns[0], size = returnRelative + tail.length;
  const callOffset = start + returnRelative - 4, call = source.readUInt32LE(callOffset);
  let branch = call & 0x03ffffff; if (branch & 0x02000000) branch -= 0x04000000;
  if (((call & 0xfc000000) >>> 0) !== 0x94000000 || callOffset + branch * 4 !== 0xe9ff14) continue;
  const adrp = source.readUInt32LE(start + 24), add = source.readUInt32LE(start + 28);
  if (((adrp & 0x9f00001f) >>> 0) !== 0x90000008 || ((add & 0xffc003ff) >>> 0) !== 0x91000108) continue;
  let imm = ((adrp >>> 5) & 0x7ffff) * 4 + ((adrp >>> 29) & 3);
  if (imm & 0x100000) imm -= 0x200000;
  const stringOffset = Math.floor((start + 24) / 4096) * 4096 + imm * 4096 + ((add >>> 10) & 4095);
  if (stringOffset < 0 || stringOffset > source.length - 128) continue;
  const flag = source.subarray(stringOffset, source.indexOf(0, stringOffset)).toString('utf8');
  const entries = matches.get(flag) ?? [];
  entries.push({ start, size, returnOffset: start + returnRelative, getterSHA256: sha(source.subarray(start, start + size)) });
  matches.set(flag, entries);
}
const bytes = await readFile(target), evidence = [];
for (const mod of allowed.filter(mod => selected.includes(mod.id))) {
  for (const flag of mod.nativeFeatureFlags) {
    const entries = matches.get(flag) ?? [];
    if (entries.length !== 1) throw new Error(`${flag}: expected one guarded Boolean getter, found ${entries.length}`);
    const entry = entries[0];
    const actual = bytes.subarray(entry.start, entry.start + entry.size);
    const expected = Buffer.from(source.subarray(entry.start, entry.start + entry.size));
    const patched = Buffer.from(expected); patched.writeUInt32LE(0x52800020, entry.returnOffset - entry.start); // mov w0, #1
    if (!actual.equals(expected) && !actual.equals(patched)) throw new Error(`${flag}: native getter changed`);
    (restore ? expected : patched).copy(bytes, entry.start);
    evidence.push({ mod: mod.id, flag, ...entry });
  }
}
if (!inspect) {
  await writeFile(target, bytes);
  await writeFile(join(root, 'native-feature-getter-evidence.json'), JSON.stringify({ build: test.build, sourceSHA256: sha(source), researchOnly: true, restored: restore, evidence }, null, 2));
}
console.log(JSON.stringify(evidence, null, 2));
