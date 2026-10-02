#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GitHubKeychain } from '../bridge/src/github-update-auth.js';
if (process.platform !== 'darwin') { console.log('skip  Native GitHub Keychain QA requires macOS'); process.exit(0); }
const directory = await mkdtemp(join(tmpdir(), 'dia-keychain-test-'));
const helper = join(directory, 'TestKeychain'), swift = join(directory, 'test.swift');
const identifier = randomUUID();
// A compiled TEST-ONLY namespace cannot read/overwrite a real updater record.
const source = (await readFile(new URL('../src/updater/github-keychain.swift', import.meta.url), 'utf8'))
  .replace('local.rttm.dia.updater.github', 'local.rttm.dia.updater.github.test.' + identifier).replace('DiaMods/DiaPlus', 'DiaMods/DiaPlus-test');
await writeFile(swift, source);
const store = new GitHubKeychain(helper);
try {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', swift, '-o', helper]);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'local.rttm.dia.updater.keychain.test', helper]);
  assert.equal(await store.get(), null);
  const value = { accessToken: randomUUID(), refreshToken: randomUUID(), expiresAt: Date.now() + 60000, refreshExpiresAt: Date.now() + 120000 };
  await store.set(value); assert.deepEqual(await store.get(), value);
  const rotated = { ...value, accessToken: randomUUID() }; await store.set(rotated); assert.deepEqual(await store.get(), rotated);
  await store.delete(); assert.equal(await store.get(), null);
  await assert.rejects(store.operation('unsupported'), { code: 'keychain' });
  console.log('ok    Native encrypted macOS Keychain add/read/rotate/delete; test namespace only, secrets over pipes, no plaintext fallback');
} finally { await store.delete().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
