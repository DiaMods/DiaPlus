#!/usr/bin/env node
import { chmod, copyFile, cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digestFiles } from './prebuilt.js';
import { verifyOfficial } from './download-official.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [version, sourceArg] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version ?? '') || !sourceArg) {
  throw new Error('usage: package-release.js v0.1.0 /path/to/official/Dia.app');
}
const config = JSON.parse(await readFile(join(root, 'src/config/release-build.json')));
const source = await verifyOfficial(await realpath(sourceArg), config.dia,
  JSON.parse(await readFile(join(root, 'src/config/updater-source.json'))));
const output = join(root, '.build/releases', version);
await mkdir(output, { recursive: true });
const label = `DiaPlus-${version}-macOS-arm64`;
const stage = join(output, label), toolkit = join(stage, 'toolkit');
await rm(stage, { recursive: true, force: true });
await mkdir(toolkit, { recursive: true });
// Only these project inputs can enter the artifact. Never copy the checkout,
// .build directory, source browser, local runtime, profile, or credentials.
for (const path of ['scripts', 'src', 'research/tools', 'bridge/src', 'bridge/config']) {
  await cp(join(root, path), join(toolkit, path), { recursive: true,
    filter: path => !/\/(?:\.state|node_modules|\.DS_Store|test(?:-|$))/.test(path) && !/\.(?:log|pcap)$/.test(path) });
}
for (const path of ['dia-custom', 'bridge/package.json', 'bridge/package-lock.json']) {
  await copyFile(join(root, path), join(toolkit, path));
}
await copyFile(join(root, 'scripts/release-launcher.command'), join(stage, 'Install Dia+.command'));
await chmod(join(stage, 'Install Dia+.command'), 0o755);
await copyFile(join(root, 'docs/RELEASE-INSTALL.md'), join(stage, 'README.md'));
const run = (command, args, env = {}) => execFileSync(command, args,
  { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 ** 2 }).toString().trim();
// Fetch only the Node distribution here; bundle-runtime also verifies this pin.
const archiveName = 'node-v24.20.0-darwin-arm64.tar.gz';
const runtime = join(root, '.build/runtime');
await mkdir(runtime, { recursive: true });
const archive = join(runtime, archiveName);
try { await readFile(archive); }
catch { run('/usr/bin/curl', ['--fail', '--location', '--show-error', 'https://nodejs.org/dist/v24.20.0/'+archiveName, '-o', archive]); }
if (digestFiles([archive]) !== '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8') throw new Error('Node archive checksum mismatch');
run('/usr/bin/tar', ['-xzf', archive, '-C', runtime]);
const nodeBin = join(runtime, 'node-v24.20.0-darwin-arm64/bin');
const buildEnv = { PATH: `${nodeBin}:${process.env.PATH}`, DIA_CUSTOM_MODS: '', DIA_CUSTOM_PROFILE: join(output, 'empty-build-profile') };
// No Codex CLI or platform optional package is distributed. The SDK is JS only.
run(join(nodeBin, 'node'), [join(toolkit, 'scripts/ensure-bridge-dependencies.js'), join(toolkit, 'bridge')], buildEnv);
const helpers = [];
const prebuilt = join(toolkit, 'prebuilt');
await mkdir(prebuilt, { recursive: true });
async function includeHelper(name, file, path, inputs = []) {
  await copyFile(path, join(prebuilt, file));
  await chmod(join(prebuilt, file), 0o755);
  helpers.push({ name, file, inputHash: inputs.length ? digestFiles(inputs) : null, sha256: digestFiles([path]) });
}
for (const enabled of [true, false]) {
  const env = { ...buildEnv };
  if (!enabled) env.DIA_CUSTOM_EFFECTIVE_MODS = 'network-isolation';
  const binary = run('/bin/zsh', [join(root, 'scripts/build-bootstrap.sh'), source], env);
  await includeHelper('bootstrap', `bootstrap-${enabled ? 'full' : 'without-brief'}.dylib`, binary,
    ['src/bootstrap/offline-bootstrap.c', 'src/bootstrap/offline-bootstrap-arm64.S',
      'src/bootstrap/offline-bootstrap-introspection.swift', '.build/bootstrap/prompt-tools-offsets.h',
      '.build/bootstrap/native-actions-offsets.h'].map(path => join(root, path)));
}
await includeHelper('apple-model', 'DiaCustomAppleModel', run('/bin/zsh', [join(root, 'scripts/build-apple-model-helper.sh')], buildEnv));
const processProbe = join(output, 'process-info');
run('/usr/bin/xcrun', ['clang', '-target', 'arm64-apple-macos14.0', '-O2', join(root, 'scripts/browser-process-info.c'), '-o', processProbe]);
run('/usr/bin/codesign', ['--force', '--sign', '-', processProbe]);
await includeHelper('process-info', 'process-info', processProbe);
const quit = join(output, 'quit-app');
run('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos14.0', join(root, 'src/updater/quit-app.swift'), '-o', quit]);
run('/usr/bin/codesign', ['--force', '--sign', '-', quit]);
await includeHelper('quit-app', 'quit-app', quit);
await writeFile(join(prebuilt, 'manifest.json'), JSON.stringify({ schemaVersion: 1, helpers }, null, 2)+'\n');
await mkdir(join(toolkit, 'runtime'));
await copyFile(archive, join(toolkit, 'runtime', archiveName));
// Preserve third-party license notices without distributing other executables.
await mkdir(join(stage, 'licenses'));
await copyFile(join(runtime, 'node-v24.20.0-darwin-arm64/LICENSE'), join(stage, 'licenses/Node.txt'));
const manifest = { schemaVersion: 1, version, ...config, commit: run('git', ['rev-parse', 'HEAD']),
  uncommittedChanges: Boolean(run('git', ['status', '--porcelain'])), nodeVersion: '24.20.0',
  contents: 'Modifier only. Official Dia is obtained on the recipient Mac. Codex uses a local installation.',
  files: {} };
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name, path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in release: ${relative}`);
    if (/(^|\/)(?:[^/]+\.app|\.state|\.env(?:\..*)?|auth\.json|credentials(?:\.(?:json|sqlite|db))?|official\.zip|codex|codex-darwin-[^/]+)$/.test(relative)) {
      throw new Error(`Forbidden browser, credential or CLI content in release: ${relative}`);
    }
    if (entry.isDirectory()) await inventory(path, relative+'/');
    else manifest.files[relative] = digestFiles([path]);
  }
}
await inventory(stage);
await writeFile(join(stage, 'release-manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
const zip = join(output, label+'.zip');
await rm(zip, { force: true });
run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', stage, zip]);
await copyFile(join(stage, 'release-manifest.json'), join(output, 'release-manifest.json'));
await writeFile(join(output, 'SHA256SUMS.txt'), `${digestFiles([zip])}  ${label}.zip\n${digestFiles([join(output, 'release-manifest.json')])}  release-manifest.json\n`);
process.stdout.write(zip+'\n');
