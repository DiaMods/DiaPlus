#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { digestFiles } from './prebuilt.js';

const directory = resolve(process.argv[2]);
const files = await readdir(directory);
const archives = files.filter(file => /^DiaPlus-v.*\.zip$/.test(file));
assert.equal(archives.length, 1, 'expected exactly one modifier ZIP');
const archive = join(directory, archives[0]);
const sums = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
assert(sums.includes(`${digestFiles([archive])}  ${archives[0]}\n`), 'ZIP checksum mismatch');
const temporary = await mkdtemp(join(tmpdir(), 'dia-plus-release-check-'));
try {
  execFileSync('/usr/bin/ditto', ['-xk', archive, temporary]);
  const stage = join(temporary, archives[0].slice(0, -4));
  const manifest = JSON.parse(await readFile(join(stage, 'release-manifest.json')));
  assert.equal(await readFile(join(stage, 'release-manifest.json'), 'utf8'), await readFile(join(directory, 'release-manifest.json'), 'utf8'));
  const found = [];
  async function verify(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      assert(!entry.isSymbolicLink(), `unexpected symlink: ${relative}`);
      assert(!/(^|\/)(?:[^/]+\.app|\.state|\.env(?:\..*)?|auth\.json|credentials(?:\.(?:json|sqlite|db))?|official\.zip|codex|codex-darwin-[^/]+)$/.test(relative), `forbidden content: ${relative}`);
      if (entry.isDirectory()) await verify(join(path, entry.name), relative + '/');
      else if (relative !== 'release-manifest.json') {
        found.push(relative);
        assert.equal(digestFiles([join(path, entry.name)]), manifest.files[relative], `modified or uninventoried file: ${relative}`);
      }
    }
  }
  await verify(stage);
  assert.deepEqual(found.sort(), Object.keys(manifest.files).sort());
  console.log(`Verified ${found.length} inventoried modifier files; no browser bundle, Codex CLI, or credential files.`);
  if (process.argv.includes('--install')) {
    const env = { ...process.env, DIA_CUSTOM_STAGING: '1', DIA_CUSTOM_PROFILE: join(temporary, 'profile'),
      DIA_CUSTOM_WORK_DIR: join(temporary, 'work'), DIA_CUSTOM_APP: join(temporary, 'Dia+.app'),
      // Any accidental compiler use now fails, including absolute xcrun/clang.
      DEVELOPER_DIR: '/nonexistent/dia-plus-no-compiler', DIA_CUSTOM_XCODE_DEVELOPER_DIR: '/nonexistent/dia-plus-no-compiler',
      DIA_CUSTOM_SIGN_IDENTITY: '-', npm_config_offline: 'true' };
    const child = spawn('/bin/zsh', [join(stage, 'Install Dia+.command'), '--no-launch'], { env, stdio: 'inherit' });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaged installer failed: ${code}`)));
    });
    const name = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleDisplayName', join(temporary, 'Dia+.app/Contents/Info.plist')], { encoding: 'utf8' }).trim();
    assert.equal(name, 'Dia+');
    const node = join(temporary, 'Dia+.app/Contents/Helpers/DiaCustomNode');
    execFileSync(node, ['--input-type=module', '-e', 'import { Codex } from "@openai/codex-sdk"; new Codex({ codexPathOverride: "/local/codex" });'], {
      cwd: join(temporary, 'Dia+.app/Contents/Resources/DiaCustomBridge'), env,
    });
    execFileSync(node, ['--input-type=module', '-e', `
      import { CustomUpdater } from './src/custom-updater.js';
      import { run } from './src/updater-common.js';
      import { join } from 'node:path';
      const updater = new CustomUpdater({ bridgeDirectory: process.cwd(),
        profileDirectory: process.env.DIA_CUSTOM_PROFILE, stateDirectory: join(process.env.DIA_CUSTOM_PROFILE, 'Bridge/.state') });
      const { toolkit, node, env } = await updater.materialize(process.argv[1]);
      const helper = await run('/bin/zsh', [join(toolkit, 'scripts/build-bootstrap.sh'), process.env.DIA_CUSTOM_SOURCE_APP || '/Applications/Dia.app'], { env });
      if (!helper.includes('/prebuilt/bootstrap-')) throw new Error('Updater did not reuse its precompiled bootstrap');
      await run(node, [join(toolkit, 'scripts/prebuilt.js'), 'quit-app'], { env });
      await run(node, [join(toolkit, 'scripts/browser-process-guard.js'), 'assert-stopped', process.env.DIA_CUSTOM_APP], { env });
    `, join(temporary, 'updater-check')], {
      cwd: join(temporary, 'Dia+.app/Contents/Resources/DiaCustomBridge'), env, timeout: 120000,
    });
    console.log('Packaged installer and updater helpers work with compiler access disabled; ad-hoc signature and bundled SDK verified.');
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
