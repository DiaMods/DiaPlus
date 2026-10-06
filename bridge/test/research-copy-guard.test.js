import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireResearchCopy } from '../../research/tools/research-copy-guard.js';

test('research tooling rejects escaped profiles/apps, symlinks and installed identities', {
  skip: process.platform !== 'darwin',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-browser-use-research-guard-'));
  const outside = await mkdtemp(join(tmpdir(), 'dia-research-outside-'));
  t.after(() => Promise.all([root, outside].map(path => rm(path, { recursive: true, force: true }))));
  const app = join(root, 'Dia+.Research.app'), profile = join(root, 'profile');
  await mkdir(join(app, 'Contents'), { recursive: true });
  await mkdir(profile);
  const manifest = { root, app, profile, bakedIsolation: true };
  const save = value => writeFile(join(root, 'test.json'), JSON.stringify(value));
  const identity = (id, build = '87864') => writeFile(join(app, 'Contents/Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleVersion</key><string>${build}</string></dict></plist>`);
  await save(manifest); await identity('local.rttm.dia.browser-use-research');
  assert.deepEqual(await requireResearchCopy(root), { root, test: manifest });
  await save({ ...manifest, app: '/Applications/Dia+.app' });
  await assert.rejects(requireResearchCopy(root), /app escaped/);
  await save({ ...manifest, profile: outside });
  await assert.rejects(requireResearchCopy(root), /profile escaped/);
  await save({ ...manifest, bakedIsolation: false });
  await assert.rejects(requireResearchCopy(root), /baked-isolation/);
  await save(manifest); await identity('local.rttm.dia');
  await assert.rejects(requireResearchCopy(root), /identity/);
  await identity('local.rttm.dia.browser-use-research', '99999');
  await assert.rejects(requireResearchCopy(root), /build/);
  await identity('local.rttm.dia.browser-use-research');
  // Only remove the empty test fixture directory, never a browser profile.
  await rm(profile, { recursive: true });
  await symlink(outside, profile);
  await assert.rejects(requireResearchCopy(root), /profile escaped/);
  await assert.rejects(requireResearchCopy(), /root is required/);
});
