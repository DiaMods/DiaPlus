#!/usr/bin/env node
// Stable installer engine. No GitHub login, SDK, compiler, or registry access.
import { readFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { verifyModManifest, validateModifierZIP, sha256, compareVersions, nodeArchive, nodeArchiveHash } from './release-verification.js';
import { verifyReleaseFiles } from './release-inventory.js';

const engine = dirname(fileURLToPath(import.meta.url));
const root = dirname(engine);
const config = JSON.parse(await readFile(join(engine, 'config.json')));
const manifestBytes = await readFile(join(root, 'release-manifest.json'));
const manifest = verifyModManifest(manifestBytes, await readFile(join(root, 'release-manifest.sig'), 'utf8'), config.modRepository, config.source);
const operatingSystem = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim().split('.').map(Number);
const minimum = manifest.minimumMacOS.split('.').map(Number);
for (let i = 0; i < minimum.length; i++) {
  if ((operatingSystem[i] ?? 0) > minimum[i]) break;
  if ((operatingSystem[i] ?? 0) < minimum[i]) throw new Error(`This release requires macOS ${manifest.minimumMacOS} or newer.`);
}
if (compareVersions(manifest.minimumInstallerVersion, config.version) > 0) throw new Error('This release requires a newer installer engine.');
if (manifest.installerVersion !== config.version) throw new Error('Installer and modifier versions do not match.');
const bundle = await readFile(join(root, manifest.assets.mods.name));
if (bundle.length !== manifest.assets.mods.length || sha256(bundle) !== manifest.assets.mods.sha256) throw new Error('Modifier bundle checksum mismatch.');
validateModifierZIP(bundle);
const archive = join(engine, 'runtime', nodeArchive);
if (sha256(await readFile(archive)) !== nodeArchiveHash) throw new Error('Bundled Node archive checksum mismatch.');
const temporary = await mkdtemp(join(root, '.install-'));
const run = (file, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { stdio: 'inherit', env });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Installer step failed. Your previous installation is preserved where possible.')));
});
try {
  await run('/usr/bin/ditto', ['-xk', join(root, manifest.assets.mods.name), temporary]);
  const toolkit = join(temporary, 'toolkit');
  await verifyReleaseFiles(toolkit, JSON.parse(await readFile(join(toolkit, 'inventory.json'))));
  // Runtime is the stable engine's pinned archive; the mod ZIP omits it.
  await mkdir(join(toolkit, 'runtime'), { recursive: true });
  await mkdir(join(toolkit, '.build/runtime'), { recursive: true });
  await copyFile(archive, join(toolkit, 'runtime', nodeArchive));
  await copyFile(archive, join(toolkit, '.build/runtime', nodeArchive));
  await run('/usr/bin/tar', ['-xzf', archive, '-C', join(toolkit, '.build/runtime')]);
  const metadata = JSON.parse(await readFile(join(toolkit, 'src/config/mod-release.json')));
  const target = JSON.parse(await readFile(join(toolkit, 'src/config/release-build.json')));
  const source = JSON.parse(await readFile(join(toolkit, 'src/config/updater-source.json')));
  if (metadata.version !== manifest.version || metadata.installerVersion !== config.version ||
      JSON.stringify(target.dia) !== JSON.stringify(manifest.dia) || JSON.stringify(source) !== JSON.stringify(config.source)) throw new Error('Signed package metadata does not match the installer.');
  const node = join(toolkit, '.build/runtime/node-v24.20.0-darwin-arm64/bin/node');
  await run(node, [join(toolkit, 'scripts/release-install.js'), ...process.argv.slice(2)], {
    ...process.env, PATH: `${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin`,
  });
} finally { await rm(temporary, { recursive: true, force: true }); }
