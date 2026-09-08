#!/usr/bin/env node
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedDownload, plist, run, validateArchivePaths, verifyArchive } from '../bridge/src/updater-common.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function verifyOfficial(app, release, source) {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 300000 });
  const signature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', app]);
  if (!signature.split('\n').includes(`TeamIdentifier=${source.teamID}`) ||
      await plist(app, 'CFBundleIdentifier') !== source.bundleID ||
      await plist(app, 'CFBundleVersion') !== release.build ||
      await plist(app, 'CFBundleShortVersionString') !== release.version) {
    throw new Error('Dia does not match the official publisher and supported release.');
  }
  return app;
}
export async function acquireOfficial(cache, installed = '/Applications/Dia.app') {
  const { dia: release } = JSON.parse(await readFile(join(root, 'src/config/release-build.json')));
  const source = JSON.parse(await readFile(join(root, 'src/config/updater-source.json')));
  if (installed) {
    try { return await verifyOfficial(installed, release, source); }
    catch { process.stderr.write(`Installed Dia is absent or differs from supported build ${release.build}; downloading the official supported copy.\n`); }
  }
  const directory = join(resolve(cache), release.build);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const archive = join(directory, 'official.zip');
  try { await stat(archive); }
  catch {
    const partial = `${archive}.partial`;
    await rm(partial, { force: true });
    process.stderr.write(`Downloading Dia ${release.version} from its official publisher…\n`);
    try {
      await run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--proto', '=https',
        '--max-time', '1200', '--max-filesize', String(release.length),
        '--output', partial, allowedDownload(release.url, source)], { timeout: 1250000 });
      verifyArchive(await readFile(partial), release, source);
      await import('node:fs/promises').then(fs => fs.rename(partial, archive));
    } finally { await rm(partial, { force: true }); }
  }
  verifyArchive(await readFile(archive), release, source);
  validateArchivePaths(await run('/usr/bin/unzip', ['-Z1', archive], { maxBytes: 32 * 1024 ** 2 }));
  const extracted = join(directory, 'source');
  await rm(extracted, { recursive: true, force: true });
  await run('/usr/bin/ditto', ['-xk', archive, extracted], { timeout: 300000 });
  return verifyOfficial(join(extracted, 'Dia.app'), release, source);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await acquireOfficial(process.argv[2] ?? join(root, '.build/official'), process.argv[3]);
  process.stdout.write(`${app}\n`);
}
