#!/usr/bin/env node
// Local end-to-end QA uses an ephemeral signing key, never the release secret.
import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const source = process.argv[2];
if (!source) throw new Error('usage: test-private-release.js /official/Dia.app');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const env = { ...process.env, DIA_PLUS_GITHUB_CLIENT_ID: 'Iv1.local-test-only', DIA_PLUS_RELEASE_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'), DIA_CUSTOM_SOURCE_APP: resolve(source) };
for (const key of Object.keys(env)) if (/^(?:GH_|GITHUB_)/.test(key)) delete env[key];
delete env.DIA_PLUS_RELEASE_SIGNING_KEY;
const run = (args, extra = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { env: { ...env, ...extra }, stdio: 'inherit' });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Private release QA step failed')));
});
const version = 'v0.0.999', directory = resolve('.build/releases', version);
await run(['scripts/package-release.js', version, source]);
await run(['scripts/verify-release.js', directory, '--unsigned']);
const manifest = JSON.parse(await readFile(resolve(directory, 'release-manifest.json')));
const reused = resolve('.build/releases/v0.0.998');
await run(['scripts/package-release.js', 'v0.0.998', source, resolve(directory, manifest.assets.engine.name)]);
await run(['scripts/verify-release.js', reused, '--unsigned']);
assert.equal(JSON.parse(await readFile(resolve(reused, 'release-manifest.json'))).assets.engine.sha256, manifest.assets.engine.sha256);
console.log('Stable installer engine reused byte-for-byte for a different mod version.');
await run(['scripts/sign-release.js', directory], { DIA_PLUS_TEST_RELEASE: '1', DIA_PLUS_RELEASE_SIGNING_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() });
await run(['scripts/verify-release.js', directory, '--install']);
console.log('Ephemeral-key private-release QA completed. These test-key assets must never be published.');
