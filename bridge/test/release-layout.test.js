import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { releaseChecksumFiles, releaseChecksums } from '../../scripts/release-checksums.js';
import { sha256 } from '../src/release-verification.js';
import { bundle } from './release-fixtures.js';

test('mod-release checksums cover only published files, without requiring the standalone engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dia-release-layout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { manifest } = bundle();
  const files = releaseChecksumFiles(manifest);
  assert.deepEqual(files, [manifest.assets.mods.name, 'DiaPlus-v0.2.0-macOS-arm64.zip', 'release-manifest.json', 'release-manifest.sig']);
  for (const file of files) await writeFile(join(directory, file), file);
  const expected = files.map(file => `${sha256(Buffer.from(file))}  ${file}\n`).join('');
  assert.equal((await releaseChecksums(directory, manifest)).toString(), expected);
  // Even an engine present for build/QA must never enter the mod-release list.
  await writeFile(join(directory, manifest.assets.engine.name), 'build input');
  assert.equal((await releaseChecksums(directory, manifest)).toString(), expected);
  await writeFile(join(directory, files[1]), 'tampered manual installer');
  assert.notEqual((await releaseChecksums(directory, manifest)).toString(), expected);
});

test('release workflow uploads the exact mod-release assets and keeps the engine separate', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const command = workflow.match(/gh release create "mods-\$RELEASE_VERSION"[\s\S]*?--verify-tag/)[0];
  const uploaded = [...command.matchAll(/release\/([A-Za-z0-9.$_-]+)/g)].map(match => match[1].replaceAll('$RELEASE_VERSION', 'v0.2.0'));
  assert.deepEqual(uploaded, [...releaseChecksumFiles(bundle().manifest), 'SHA256SUMS.txt', 'SHA256SUMS.sig']);
  assert(!command.includes('release/*'));
  assert.match(workflow, /gh release create "installer-\$INSTALLER_VERSION" "release\/DiaPlus-Installer-\$INSTALLER_VERSION-macOS-arm64.zip" --verify-tag --draft/);
});
