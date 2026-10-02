#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquireOfficial } from './download-official.js';
import { prebuiltHelper } from './prebuilt.js';
import { run, plist } from '../bridge/src/updater-common.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Dia+ requires an Apple Silicon Mac.');
const osVersion = await run('/usr/bin/sw_vers', ['-productVersion']);
const targetRelease = JSON.parse(await readFile(join(root, 'src/config/release-build.json'))).dia;
const minimum = Number((await plist(process.env.DIA_CUSTOM_SOURCE_APP ?? '/Applications/Dia.app', 'LSMinimumSystemVersion').catch(() => '14')).split('.')[0]);
if (Number(osVersion.split('.')[0]) < Math.max(14, minimum)) throw new Error('This Dia+ release requires a newer macOS version.');
const args = process.argv.slice(2);
if (args.some(arg => !['--no-launch', '--download', '--yes', '--allow-disable-incompatible'].includes(arg))) throw new Error('Usage: Install Dia+.command [--download] [--no-launch] [--yes] [--allow-disable-incompatible]');
const cache = join(homedir(), 'Library/Caches/DiaPlus Installer');
const source = await acquireOfficial(cache, args.includes('--download') ? null : process.env.DIA_CUSTOM_SOURCE_APP);
let applications = '/Applications';
try { await access(applications, constants.W_OK); }
catch { applications = join(homedir(), 'Applications'); await mkdir(applications, { recursive: true }); }
const target = process.env.DIA_CUSTOM_APP ?? join(applications, 'Dia+.app');
if (Number(await plist(target, 'CFBundleVersion').catch(() => '0')) > Number(targetRelease.build)) throw new Error('Refusing to downgrade the installed Dia build. Obtain a newer audited installer.');
const requested = (await run(process.execPath, [join(root, 'scripts/mods.js'), 'resolved'])).split(',').filter(Boolean);
const compatibility = JSON.parse(await run(process.execPath, [join(root, 'scripts/compatibility.js'), source, '--mods', requested.join(','), '--json'], { timeout: 300000 }));
const failures = compatibility.perMod.filter(mod => !mod.compatible);
if (failures.some(mod => mod.required || mod.criticality === 'critical')) throw new Error('Required mods are incompatible. The existing app has not been changed.');
async function confirm(question, flag) {
  if (args.includes(flag)) return;
  if (!process.stdin.isTTY) throw new Error(`Confirmation required: ${question} Run interactively or explicitly use ${flag}.`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { if (!/^y(?:es)?$/i.test((await prompt.question(question + ' [y/N] ')).trim())) throw new Error('Installation cancelled. Your existing installation is unchanged.'); }
  finally { prompt.close(); }
}
if (failures.length) await confirm('Temporarily omit incompatible optional mods: ' + failures.map(mod => mod.label).join(', ') + '? Your stored mod choices will be retained.', '--allow-disable-incompatible');
await confirm(`Install Dia ${targetRelease.version} with these mods, gracefully close Dia+, and restart it?`, '--yes');
const effective = compatibility.perMod.filter(mod => mod.compatible).map(mod => mod.id).join(',');
const quit = prebuiltHelper('quit-app');
// Installer invocation authorizes a graceful close; a cancelled browser quit
// fails before any replacement. QA can explicitly use an isolated target.
process.stdout.write('Closing any existing Dia+ session…\n');
try {
  if (!process.env.DIA_CUSTOM_APP) {
    await run(quit, [join(applications, 'Dia Custom RTTM.app')]);
  }
  await run(quit, [target]);
} catch {
  process.stderr.write('The browser did not finish quitting. Use Command-Q in Dia+, then run this installer again. Your existing app has not been replaced.\n');
  process.exit(1);
}
process.stdout.write(`Installing Dia+ at ${target}…\n`);
const child = spawn('/bin/zsh', [join(root, 'scripts/build.sh'), '--replace'], {
  stdio: 'inherit', env: { ...process.env, DIA_CUSTOM_SOURCE_APP: source, DIA_CUSTOM_APP: target,
    DIA_CUSTOM_MODS: requested.join(','), DIA_CUSTOM_EFFECTIVE_MODS: effective,
    DIA_CUSTOM_WORK_DIR: process.env.DIA_CUSTOM_WORK_DIR ?? join(homedir(), 'Library/Application Support/DiaPlus Installer') },
});
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installation failed (${code}); see the details above.`)));
});
if (!args.includes('--no-launch')) await run('/usr/bin/open', ['-n', '-a', target]);
process.stdout.write(`Dia+ is ready: ${target}\nOpen Dia Mod Settings to configure providers and updates.\n`);
