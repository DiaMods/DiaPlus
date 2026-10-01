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
const constructor = { '87561': 0x2dbbd08, '87864': 0x2dfa1c8 }[build];
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
  process.stdout.write(`ok    Dia ${build} preserves async stream ownership, rejects unsafe constructors and guards token fallback\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
