#!/usr/bin/env node
import { chmod, copyFile, cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digestFiles } from './prebuilt.js';
import { verifyOfficial } from './download-official.js';
import { nodeArchive, nodeArchiveHash, versionParts, validateModifierZIP, sha256 } from '../bridge/src/release-verification.js';
import { verifyReleaseFiles } from '../bridge/src/release-inventory.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [version, sourceArg, engineArg] = process.argv.slice(2);
versionParts(version);
if (!sourceArg) throw new Error('usage: package-release.js v0.1.0 /official/Dia.app [existing-installer.zip]');
const run = (command, args, env = {}) => execFileSync(command, args, { cwd: root,
  env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 ** 2 }).toString().trim();
const json = path => readFile(path, 'utf8').then(JSON.parse);
const target = await json(join(root, 'src/config/release-build.json'));
const installer = await json(join(root, 'src/config/installer-release.json'));
versionParts(installer.version); versionParts(installer.minimumVersion);
const sourceConfig = await json(join(root, 'src/config/updater-source.json'));
const source = await verifyOfficial(await realpath(sourceArg), target.dia, sourceConfig);
sourceConfig.modRepository = { repository: 'DiaMods/DiaPlus', clientID: process.env.DIA_PLUS_GITHUB_CLIENT_ID,
  publicKey: process.env.DIA_PLUS_RELEASE_PUBLIC_KEY, protocolVersion: 1 };
if (!/^[A-Za-z0-9._-]{8,100}$/.test(sourceConfig.modRepository.clientID ?? '') ||
    Buffer.from(sourceConfig.modRepository.publicKey ?? '', 'base64').length !== 32) throw new Error('Configure the GitHub App client ID and Ed25519 public key (not signing secrets) before packaging.');
const output = join(root, '.build/releases', version);
await mkdir(output, { recursive: true });
const stage = join(output, 'staging');
await rm(stage, { recursive: true, force: true });
const toolkit = join(stage, 'toolkit'), engine = join(stage, 'engine');
await mkdir(toolkit, { recursive: true });
// Explicit inputs exclude browser bundles, profiles, captures and credentials.
for (const path of ['scripts', 'src', 'bridge/src', 'bridge/config']) {
  await cp(join(root, path), join(toolkit, path), { recursive: true,
    filter: path => !/\/(?:\.state|node_modules|\.DS_Store|test[^/]*)(?:\/|$)/.test(path) && !/\.(?:log|pcap)$/.test(path) });
}
await mkdir(join(toolkit, 'research/tools'), { recursive: true });
for (const file of ['discover-prompt-tools.js', 'parse-swift-fields.js']) await copyFile(join(root, 'research/tools', file), join(toolkit, 'research/tools', file));
for (const path of ['dia-custom', 'bridge/package.json', 'bridge/package-lock.json']) await copyFile(join(root, path), join(toolkit, path));
await writeFile(join(toolkit, 'src/config/updater-source.json'), JSON.stringify(sourceConfig, null, 2) + '\n');
await writeFile(join(toolkit, 'src/config/mod-release.json'), JSON.stringify({ version, installerVersion: installer.version, protocolVersion: 1 }, null, 2) + '\n');
const compatibility = JSON.parse(run(process.execPath, [join(root, 'scripts/compatibility.js'), source, '--json'], { DIA_CUSTOM_MODS: '' }));
if (compatibility.buildStatus !== 'audited' || compatibility.perMod.some(mod => !mod.compatible && (mod.required || mod.criticality === 'critical'))) throw new Error('Release requires an explicitly audited build and passing required mods');
delete compatibility.app;
const enabled = compatibility.perMod.filter(mod => mod.compatible).map(mod => mod.id);
const runtime = join(root, '.build/runtime'), archive = join(runtime, nodeArchive);
await mkdir(runtime, { recursive: true });
try { await stat(archive); } catch { run('/usr/bin/curl', ['--fail', '--location', '--show-error', 'https://nodejs.org/dist/v24.20.0/' + nodeArchive, '-o', archive]); }
if (digestFiles([archive]) !== nodeArchiveHash) throw new Error('Node archive checksum mismatch');
run('/usr/bin/tar', ['-xzf', archive, '-C', runtime]);
const nodeBin = join(runtime, 'node-v24.20.0-darwin-arm64/bin');
const buildEnv = { PATH: `${nodeBin}:${process.env.PATH}`, DIA_CUSTOM_MODS: enabled.join(','), DIA_CUSTOM_EFFECTIVE_MODS: enabled.join(','), DIA_CUSTOM_PROFILE: join(output, 'empty-build-profile') };
run(join(nodeBin, 'node'), [join(toolkit, 'scripts/ensure-bridge-dependencies.js'), join(toolkit, 'bridge')], buildEnv);
const helpers = [], prebuilt = join(toolkit, 'prebuilt');
await mkdir(prebuilt);
async function helper(name, file, path, inputs = []) {
  await copyFile(path, join(prebuilt, file)); await chmod(join(prebuilt, file), 0o755);
  helpers.push({ name, file, inputHash: inputs.length ? digestFiles(inputs) : null, sha256: digestFiles([path]) });
}
for (const developer of enabled.includes('developer-tools') ? [true, false] : [false]) {
  for (const brief of enabled.includes('morning-brief') ? [true, false] : [false]) {
    const mods = enabled.filter(id => (developer || id !== 'developer-tools') && (brief || id !== 'morning-brief'));
    const binary = run('/bin/zsh', [join(root, 'scripts/build-bootstrap.sh'), source], { ...buildEnv, DIA_CUSTOM_EFFECTIVE_MODS: mods.join(',') });
    await helper('bootstrap', `bootstrap-dev-${developer}-brief-${brief}.dylib`, binary,
      ['src/bootstrap/offline-bootstrap.c', 'src/bootstrap/offline-bootstrap-arm64.S', 'src/bootstrap/offline-bootstrap-introspection.swift',
        '.build/bootstrap/prompt-tools-offsets.h', '.build/bootstrap/native-actions-offsets.h'].map(path => join(root, path)));
  }
}
await helper('apple-model', 'DiaCustomAppleModel', run('/bin/zsh', [join(root, 'scripts/build-apple-model-helper.sh')], buildEnv));
await helper('github-keychain', 'DiaCustomGitHubKeychain', run('/bin/zsh', [join(root, 'scripts/build-github-keychain.sh')], buildEnv));
for (const [name, language, input] of [['process-info', 'clang', 'scripts/browser-process-info.c'], ['quit-app', 'swiftc', 'src/updater/quit-app.swift'], ['installer-bootstrap', 'clang', 'src/updater/installer-bootstrap.c']]) {
  const binary = join(output, name);
  run('/usr/bin/xcrun', [language, '-target', 'arm64-apple-macos14.0', '-O2', join(root, input), '-o', binary].filter(arg => language !== 'swiftc' || arg !== '-O2'));
  run('/usr/bin/codesign', ['--force', '--sign', '-', binary]);
  await helper(name, name, binary);
}
await writeFile(join(prebuilt, 'manifest.json'), JSON.stringify({ schemaVersion: 1, helpers }, null, 2) + '\n');
async function inventory(directory) {
  const files = {};
  async function walk(path, prefix = '') {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink() || /(^|\/)(?:[^/]+\.app|\.state|\.env(?:\..*)?|auth\.json|credentials(?:\.(?:json|sqlite|db))?|official\.zip|codex|codex-darwin-[^/]+)$/.test(name)) throw new Error(`Forbidden release content: ${name}`);
      if (entry.isDirectory()) await walk(join(path, entry.name), name + '/');
      else if (name !== 'inventory.json') files[name] = digestFiles([join(path, entry.name)]);
    }
  }
  await walk(directory);
  const result = { schemaVersion: 1, files };
  await writeFile(join(directory, 'inventory.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
const engineFiles = {
  'install.js': 'scripts/bootstrap-install.js', 'launcher.command': 'scripts/release-launcher.command',
  'release-verification.js': 'bridge/src/release-verification.js', 'download-origin.js': 'bridge/src/download-origin.js',
  'release-inventory.js': 'bridge/src/release-inventory.js',
};
const engineConfig = { version: installer.version, modRepository: sourceConfig.modRepository, source: sourceConfig };
const engineIdentity = sha256(Buffer.concat([Buffer.from(JSON.stringify(engineConfig)), ...await Promise.all(Object.values(engineFiles).map(file => readFile(join(root, file))))]));
const engineName = `DiaPlus-Installer-${installer.version}-macOS-arm64.zip`, engineZIP = join(output, engineName);
if (engineArg) {
  const data = await readFile(resolve(engineArg)); validateModifierZIP(data, 'engine/');
  run('/usr/bin/ditto', ['-xk', resolve(engineArg), stage]);
  const record = await json(join(engine, 'engine-manifest.json'));
  if (record.sourceIdentity !== engineIdentity || record.version !== installer.version) throw new Error('Installer sources or trust configuration changed. Bump installer-release.json and rebuild the engine.');
  await verifyReleaseFiles(engine, await json(join(engine, 'inventory.json')));
  for (const [file, path] of Object.entries(engineFiles)) if (sha256(await readFile(join(engine, file))) !== sha256(await readFile(join(root, path)))) throw new Error('Reused installer does not match its source');
  if (JSON.stringify(await json(join(engine, 'config.json'))) !== JSON.stringify(engineConfig) || digestFiles([join(engine, 'runtime', nodeArchive)]) !== nodeArchiveHash) throw new Error('Reused installer configuration/runtime changed');
  await copyFile(resolve(engineArg), engineZIP);
} else {
  await mkdir(join(engine, 'runtime'), { recursive: true });
  for (const [file, path] of Object.entries(engineFiles)) await copyFile(join(root, path), join(engine, file));
  await chmod(join(engine, 'launcher.command'), 0o755);
  await writeFile(join(engine, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(engine, 'config.json'), JSON.stringify(engineConfig, null, 2) + '\n');
  await writeFile(join(engine, 'engine-manifest.json'), JSON.stringify({ version: installer.version, sourceIdentity: engineIdentity }, null, 2) + '\n');
  await copyFile(archive, join(engine, 'runtime', nodeArchive));
  await copyFile(join(runtime, 'node-v24.20.0-darwin-arm64/LICENSE'), join(engine, 'Node-LICENSE.txt'));
  await inventory(engine);
  await rm(engineZIP, { force: true }); run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', engine, engineZIP]);
}
await inventory(toolkit);
const modsName = `DiaPlus-Mods-${version}-macOS-arm64.zip`, modsZIP = join(output, modsName);
await rm(modsZIP, { force: true }); run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', toolkit, modsZIP]);
validateModifierZIP(await readFile(modsZIP));
const describe = async (name, path) => ({ name, length: (await stat(path)).size, sha256: digestFiles([path]) });
const manifest = { schemaVersion: 2, protocolVersion: 1, repository: 'DiaMods/DiaPlus', version, tag: 'mods-' + version,
  commit: run('git', ['rev-parse', 'HEAD']), uncommittedChanges: Boolean(run('git', ['status', '--porcelain'])), architecture: 'arm64', minimumMacOS: run('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', join(source, 'Contents/Info.plist')]),
  installerVersion: installer.version, minimumInstallerVersion: installer.minimumVersion, nodeArchive, nodeArchiveHash,
  dia: target.dia, compatibility, assets: { mods: await describe(modsName, modsZIP), engine: await describe(engineName, engineZIP) } };
await writeFile(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await rm(stage, { recursive: true, force: true });
process.stdout.write(output + '\n');
