#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquireOfficial } from './download-official.js';
import { prebuiltHelper } from './prebuilt.js';
import { run } from '../bridge/src/updater-common.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Dia+ requires an Apple Silicon Mac.');
const osVersion = await run('/usr/bin/sw_vers', ['-productVersion']);
if (Number(osVersion.split('.')[0]) < 14) throw new Error('Dia+ requires macOS 14 or newer.');
const args = process.argv.slice(2);
if (args.some(arg => !['--no-launch', '--download'].includes(arg))) throw new Error('Usage: Install Dia+.command [--download] [--no-launch]');
const cache = join(homedir(), 'Library/Caches/DiaPlus Installer');
const source = await acquireOfficial(cache, args.includes('--download') ? null : process.env.DIA_CUSTOM_SOURCE_APP);
let applications = '/Applications';
try { await access(applications, constants.W_OK); }
catch { applications = join(homedir(), 'Applications'); await mkdir(applications, { recursive: true }); }
const target = process.env.DIA_CUSTOM_APP ?? join(applications, 'Dia+.app');
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
    DIA_CUSTOM_WORK_DIR: process.env.DIA_CUSTOM_WORK_DIR ?? join(homedir(), 'Library/Application Support/DiaPlus Installer') },
});
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installation failed (${code}); see the details above.`)));
});
if (!args.includes('--no-launch')) await run('/usr/bin/open', ['-n', '-a', target]);
process.stdout.write(`Dia+ is ready: ${target}\nOpen Dia Mod Settings to configure providers and updates.\n`);
