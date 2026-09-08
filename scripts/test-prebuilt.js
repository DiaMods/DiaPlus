#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prebuiltHelper, digestFiles } from './prebuilt.js';
const root = await mkdtemp(join(tmpdir(), 'dia-prebuilt-test-'));
try {
  assert.equal(prebuiltHelper('bootstrap', [], root), null);
  await mkdir(join(root, 'prebuilt'));
  const binary = join(root, 'prebuilt/bootstrap.dylib'), header = join(root, 'offsets.h');
  await writeFile(binary, 'fixture helper'); await writeFile(header, 'build 86584; offset 123');
  const manifest = { schemaVersion: 1, helpers: [{ name: 'bootstrap', file: 'bootstrap.dylib',
    sha256: digestFiles([binary]), inputHash: digestFiles([header]) }] };
  await writeFile(join(root, 'prebuilt/manifest.json'), JSON.stringify(manifest));
  assert.equal(prebuiltHelper('bootstrap', [header], root), binary);
  await writeFile(header, 'new build; offset changed');
  assert.throws(() => prebuiltHelper('bootstrap', [header], root), /No compatible precompiled/);
  await writeFile(header, 'build 86584; offset 123');
  await writeFile(binary, 'tampered helper');
  assert.throws(() => prebuiltHelper('bootstrap', [header], root), /checksum mismatch/);
  manifest.helpers[0].file = '../../outside';
  await writeFile(join(root, 'prebuilt/manifest.json'), JSON.stringify(manifest));
  assert.throws(() => prebuiltHelper('bootstrap', [header], root), /No compatible precompiled/);
  console.log('ok    precompiled helpers reject mismatched ABI, tampering, and paths outside the package');
} finally { await rm(root, { recursive: true, force: true }); }
