#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2]);
const info = join(source, 'Contents/Info.plist');
const build = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', info], { encoding: 'utf8' }).trim();
const constructor = { '87561': 0x2dbbd08, '87864': 0x2dfa1c8, '88564': 0x2f7ac70, '88592': 0x2f7b800, '89443': 0x2ae4a7c, '88879': 0x2ff1014 }[build];
if (!constructor) throw new Error('This regression covers the 1.50+ concurrent-stream constructor change.');
const root = await mkdtemp(join(tmpdir(), 'dia-account-regression-'));
const app = join(root, 'Dia Custom Account Fixture.app');
const executable = join(app, 'Contents/MacOS/Dia');
const patcher = join(scripts, '../src/patches/patch-no-account.js');
const run = (...args) => execFileSync(process.execPath, [patcher, ...args, app], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await mkdir(dirname(executable), { recursive: true });
  await copyFile(info, join(app, 'Contents/Info.plist'));
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier local.rttm.dia', join(app, 'Contents/Info.plist')]);
  await copyFile(join(source, 'Contents/MacOS/Dia'), executable);
  const original = await readFile(executable);
  run('--check');
  assert.deepEqual(await readFile(executable), original, 'checking must not mutate a signed source');
  run('--capabilities-only');
  run('--anonymous-only');
  const patched = await readFile(executable);
  assert.equal(patched.length, original.length);
  assert.deepEqual(patched.subarray(constructor, constructor + 4), original.subarray(constructor, constructor + 4),
    'local restored mode must retain the constructor with independent async subscribers');
  run('--check'); run('--capabilities-only'); run('--anonymous-only');
  assert.deepEqual(await readFile(executable), patched, 'patching must be idempotent');
  const corrupt = Buffer.from(patched);
  corrupt.writeUInt32LE(0x94000000, constructor);
  await writeFile(executable, corrupt);
  assert.throws(() => run('--check', '--anonymous-only'), /unexpected instruction/);
  assert.throws(() => run('--anonymous-only'), /unexpected instruction/);
  assert.deepEqual(await readFile(executable), corrupt, 'reject an unsafe constructor without a partial write');
  if (build === '87864') {
    assert.equal(patched.readUInt32LE(0xf2b7a0), 0x14000017,
      'local authentication must branch to the native no-auth continuation');
    assert.deepEqual(patched.subarray(0xf2cf40, 0xf2cf50), original.subarray(0xf2cf40, 0xf2cf50),
      'preserve the bearer-token dependency getter and its ABI');
    assert.deepEqual(patched.subarray(0xf2cce8, 0xf2ccfc), original.subarray(0xf2cce8, 0xf2ccfc),
      'do not repurpose placeholder closures');
    for (const offset of [0xf2b788, 0xf2b7a0, 0xf2b7fc]) {
      const invalidProvider = Buffer.from(patched);
      invalidProvider[offset] ^= 1;
      await writeFile(executable, invalidProvider);
      assert.throws(() => run('--capabilities-only'), /unexpected instruction/);
      assert.deepEqual(await readFile(executable), invalidProvider, 'reject changed local request-authentication ABI without partial writes');
    }
    // An additional direct caller makes the repurposed token error continuation unsafe.
    const referenced = Buffer.from(patched);
    const from = 0x3200, target = 0x45b37fc;
    referenced.writeUInt32LE((0x14000000 | ((target - from) / 4)) >>> 0, from);
    await writeFile(executable, referenced);
    assert.throws(() => run('--check', '--capabilities-only'), /token error continuation gained a reference/);
  }
  if (['88564', '88592', '88879', '89443'].includes(build)) {
    const current = build === '88592';
    const dia155 = build === '89443';
    const dia154 = build === '88879';
    const request = dia155 ? 0xf9010c : dia154 ? 0xf82524 : current ? 0xf74804 : 0xf73bb4;
    const cave = dia155 ? 0x55af1b4 : dia154 ? 0x5207b54 : current ? 0x51515dc : 0x5150b2c;
    assert.equal(patched.readUInt32LE(request), 0x14000017,
      'local authentication must use the independently audited no-auth continuation');
    assert.equal(patched.readUInt32LE(cave + 8), 0xf900eaff,
      'clear the new 0x1d0 error slot, not the obsolete 0xb0 slot');
    // Decode each patched Clia closure and require the known constant-true
    // function, so a wrong page relocation cannot pass as valid patch bytes.
    for (const offset of dia155 ? [0xfe18dc, 0xfe18f4, 0xfe190c] : dia154 ? [0xfd0260, 0xfd0278, 0xfd0290] : current ? [0xfc24d0, 0xfc24e8, 0xfc2500] : [0xfc1880, 0xfc1898, 0xfc18b0]) {
      const adrp = patched.readUInt32LE(offset), add = patched.readUInt32LE(offset + 4);
      const immediate = ((adrp >>> 5 & 0x7ffff) << 2) | (adrp >>> 29 & 3);
      const signed = immediate & 0x100000 ? immediate - 0x200000 : immediate;
      assert.equal((offset & ~4095) + signed * 4096 + (add >>> 10 & 4095), dia155 ? 0x25e64 : dia154 ? 0x25574 : 0x255e0);
    }
    const guards = dia155 ? [0xf900f4, 0xf9010c, 0xf90168, 0x55aefc4, 0x55aefd4, 0x55af024, 0x25e64, 0x6055990, 0xfe186c, 0xfe18e4, 0xfe18fc, 0xfe1914] : dia154
      ? [0xf8250c, 0xf82524, 0xf82580, 0x5207964, 0x5207974, 0x52079c4,
        0x25574, 0x5cf8530, 0xfd01f0, 0xfd0268, 0xfd0280, 0xfd0298]
      : current
      ? [0xf747ec, 0xf74804, 0xf74860, 0x51513ec, 0x51513fc, 0x515144c,
        0x255e0, 0x5c19eb0, 0xfc2460, 0xfc24d8, 0xfc24f0, 0xfc2508]
      : [0xf73b9c, 0xf73bb4, 0xf73c10, 0x515093c, 0x515094c,
        0x515099c, 0x255e0, 0x5c19584, 0xfc1810, 0xfc1888, 0xfc18a0, 0xfc18b8];
    for (const offset of guards) {
      const invalid = Buffer.from(patched);
      invalid[offset] ^= 1;
      await writeFile(executable, invalid);
      assert.throws(() => run('--capabilities-only'), /unexpected instruction|layout changed/);
      assert.deepEqual(await readFile(executable), invalid, 'reject changed 1.53 ABI without partial writes');
    }
    const referenced = Buffer.from(patched);
    const from = 0x3268, target = cave;
    referenced.writeUInt32LE((0x14000000 | ((target - from) / 4)) >>> 0, from);
    await writeFile(executable, referenced);
    assert.throws(() => run('--check', '--capabilities-only'), /token error continuation gained a reference/);
    assert.throws(() => run('--capabilities-only'), /token error continuation gained a reference/);
    assert.deepEqual(await readFile(executable), referenced, 'reject an unexpected token continuation caller without writing');
  }
  process.stdout.write(`ok    Dia ${build} preserves async stream ownership, rejects unsafe constructors and guards token fallback\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
