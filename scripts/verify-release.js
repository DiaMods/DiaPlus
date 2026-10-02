#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPublicKey, verify } from 'node:crypto';
import { sha256, validateModifierZIP, verifyModManifest, zipEntry } from '../bridge/src/release-verification.js';
import { verifyReleaseFiles } from '../bridge/src/release-inventory.js';

const directory = resolve(process.argv[2]);
const source = JSON.parse(await readFile(new URL('../src/config/updater-source.json', import.meta.url)));
const bytes = await readFile(join(directory, 'release-manifest.json'));
const unsigned = process.argv.includes('--unsigned');
const manifest = unsigned ? JSON.parse(bytes) : verifyModManifest(bytes, await readFile(join(directory, 'release-manifest.sig'), 'utf8'), { publicKey: process.env.DIA_PLUS_RELEASE_PUBLIC_KEY }, source);
const temporary = await mkdtemp(join(tmpdir(), 'dia-plus-release-check-'));
try {
  for (const [kind, prefix] of [['mods', 'toolkit/'], ['engine', 'engine/']]) {
    const asset = manifest.assets[kind], data = await readFile(join(directory, asset.name));
    assert.equal(data.length, asset.length); assert.equal(sha256(data), asset.sha256);
    validateModifierZIP(data, prefix);
    execFileSync('/usr/bin/ditto', ['-xk', join(directory, asset.name), temporary]);
    await verifyReleaseFiles(join(temporary, prefix.slice(0, -1)), JSON.parse(zipEntry(data, prefix + 'inventory.json', prefix)));
  }
  if (unsigned) {
    assert(!process.argv.includes('--install'), 'Cannot install an unsigned release');
    console.log('Unsigned assets verified; signing and signed installer QA must pass before release creation.');
  } else {
    const name = `DiaPlus-${manifest.version}-macOS-arm64.zip`, data = await readFile(join(directory, name));
    const sums = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
    const checksumSignature = Buffer.from((await readFile(join(directory, 'SHA256SUMS.sig'), 'utf8')).trim(), 'base64');
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(process.env.DIA_PLUS_RELEASE_PUBLIC_KEY, 'base64')]), format: 'der', type: 'spki' });
    assert(checksumSignature.length === 64 && verify(null, Buffer.from(sums), publicKey, checksumSignature), 'Checksum signature verification failed');
    for (const file of [name, manifest.assets.mods.name, manifest.assets.engine.name, 'release-manifest.json', 'release-manifest.sig']) assert(sums.includes(`${sha256(await readFile(join(directory, file)))}  ${file}\n`), `Checksum mismatch: ${file}`);
    validateModifierZIP(data, name.slice(0, -4) + '/');
    execFileSync('/usr/bin/ditto', ['-xk', join(directory, name), temporary]);
    const stage = join(temporary, name.slice(0, -4));
    assert.equal(sha256(await readFile(join(stage, 'release-manifest.json'))), sha256(bytes));
    assert.equal(await readFile(join(stage, 'release-manifest.sig'), 'utf8'), await readFile(join(directory, 'release-manifest.sig'), 'utf8'));
    assert.equal(sha256(await readFile(join(stage, manifest.assets.mods.name))), manifest.assets.mods.sha256);
    const engineInventory = JSON.parse(zipEntry(await readFile(join(directory, manifest.assets.engine.name)), 'engine/inventory.json', 'engine/'));
    await verifyReleaseFiles(join(stage, 'engine'), engineInventory);
    assert.equal(sha256(await readFile(join(stage, 'Install Dia+.command'))), engineInventory.files['launcher.command']);
    console.log('Signed manifest, mod bundle, engine, manual installer and inventories verified.');
    if (process.argv.includes('--install')) {
      const env = { ...process.env, DIA_CUSTOM_STAGING: '1', DIA_CUSTOM_PROFILE: join(temporary, 'profile'),
        DIA_CUSTOM_WORK_DIR: join(temporary, 'work'), DIA_CUSTOM_APP: join(temporary, 'Dia+.app'),
        DEVELOPER_DIR: '/nonexistent/dia-plus-no-compiler', DIA_CUSTOM_XCODE_DEVELOPER_DIR: '/nonexistent/dia-plus-no-compiler',
        DIA_CUSTOM_SIGN_IDENTITY: '-', npm_config_offline: 'true' };
      for (const key of Object.keys(env)) if (/^(?:GH_|GITHUB_|DIA_PLUS_)/.test(key)) delete env[key];
      delete env.DIA_CUSTOM_MODS; delete env.DIA_CUSTOM_EFFECTIVE_MODS;
      const child = spawn('/bin/zsh', [join(stage, 'Install Dia+.command'), '--no-launch', '--yes', '--allow-disable-incompatible'], { env, stdio: 'inherit' });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaged installer failed: ${code}`))); });
      const plist = join(temporary, 'Dia+.app/Contents/Info.plist');
      assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :DiaCustomModVersion', plist], { encoding: 'utf8' }).trim(), manifest.version);
      assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', plist], { encoding: 'utf8' }).trim(), manifest.dia.build);
      const node = join(temporary, 'Dia+.app/Contents/Helpers/DiaCustomNode');
      execFileSync(node, ['--input-type=module', '-e', 'import { Codex } from "@openai/codex-sdk"; new Codex({ codexPathOverride: "/local/codex" });'], { cwd: join(temporary, 'Dia+.app/Contents/Resources/DiaCustomBridge'), env });
      console.log('Manual installer passed with no GitHub credentials and compiler access disabled; SDK, versions and precompiled helpers verified.');
    }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
