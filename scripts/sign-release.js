#!/usr/bin/env node
// Run only in the isolated signing job; never compile or execute bundle code.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { verifyModManifest, validateModifierZIP, sha256 } from '../bridge/src/release-verification.js';
import { verifyReleaseFiles } from '../bridge/src/release-inventory.js';
import { releaseChecksums } from './release-checksums.js';

const directory = resolve(process.argv[2] ?? 'release');
const source = JSON.parse(await readFile(new URL('../src/config/updater-source.json', import.meta.url)));
const config = { publicKey: process.env.DIA_PLUS_RELEASE_PUBLIC_KEY };
const key = createPrivateKey(process.env.DIA_PLUS_RELEASE_SIGNING_KEY ?? '');
delete process.env.DIA_PLUS_RELEASE_SIGNING_KEY;
const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' });
if (key.asymmetricKeyType !== 'ed25519' || publicKey.subarray(-32).toString('base64') !== config.publicKey) throw new Error('Signing key does not match the installed public trust anchor');
const bytes = await readFile(join(directory, 'release-manifest.json'));
const signature = sign(null, bytes, key).toString('base64') + '\n';
const manifest = verifyModManifest(bytes, signature, config, source);
if (manifest.uncommittedChanges && process.env.DIA_PLUS_TEST_RELEASE !== '1') throw new Error('Production releases require a clean committed checkout');
if (process.env.RELEASE_COMMIT && manifest.commit !== process.env.RELEASE_COMMIT) throw new Error('Release commit changed');
const temporary = await mkdtemp(join(tmpdir(), 'dia-plus-compose-'));
const label = `DiaPlus-${manifest.version}-macOS-arm64`, stage = join(temporary, label);
const run = (file, args, cwd) => execFileSync(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  await mkdir(stage);
  for (const [kind, prefix] of [['mods', 'toolkit/'], ['engine', 'engine/']]) {
    const asset = manifest.assets[kind], zip = await readFile(join(directory, asset.name));
    if (zip.length !== asset.length || sha256(zip) !== asset.sha256) throw new Error('Signing input asset checksum mismatch');
    validateModifierZIP(zip, prefix);
    if (kind === 'engine') {
      if (process.platform === 'darwin') run('/usr/bin/ditto', ['-xk', join(directory, asset.name), stage]);
      else run('/usr/bin/unzip', ['-q', join(directory, asset.name), '-d', stage]);
    }
  }
  const engine = join(stage, 'engine');
  await verifyReleaseFiles(engine, JSON.parse(await readFile(join(engine, 'inventory.json'))));
  const engineConfig = JSON.parse(await readFile(join(engine, 'config.json')));
  const expectedRepository = { repository: 'DiaMods/DiaPlus', clientID: process.env.DIA_PLUS_GITHUB_CLIENT_ID, publicKey: config.publicKey, protocolVersion: 1 };
  const expectedSource = { ...source, modRepository: expectedRepository };
  if (engineConfig.version !== manifest.installerVersion || JSON.stringify(engineConfig.modRepository) !== JSON.stringify(expectedRepository) ||
      JSON.stringify(engineConfig.source) !== JSON.stringify(expectedSource)) throw new Error('Installer trust anchor or version mismatch');
  await copyFile(join(engine, 'launcher.command'), join(stage, 'Install Dia+.command'));
  await copyFile(join(directory, manifest.assets.mods.name), join(stage, manifest.assets.mods.name));
  await writeFile(join(stage, 'release-manifest.json'), bytes);
  await writeFile(join(stage, 'release-manifest.sig'), signature);
  await copyFile(new URL('../docs/RELEASE-INSTALL.md', import.meta.url), join(stage, 'README.md'));
  const manual = label + '.zip';
  await rm(join(directory, manual), { force: true });
  if (process.platform === 'darwin') run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', stage, join(directory, manual)]);
  else run('/usr/bin/zip', ['-q', '-r', join(directory, manual), label], temporary);
  await writeFile(join(directory, 'release-manifest.sig'), signature);
  const checksums = await releaseChecksums(directory, manifest);
  await writeFile(join(directory, 'SHA256SUMS.txt'), checksums);
  await writeFile(join(directory, 'SHA256SUMS.sig'), sign(null, checksums, key).toString('base64') + '\n');
  console.log(`Signed ${manifest.tag} and assembled its credential-free manual installer.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
