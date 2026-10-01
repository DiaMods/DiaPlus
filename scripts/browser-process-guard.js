#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { prebuiltHelper } from './prebuilt.js';

function normalizedPath(value) {
  try { return realpathSync(value); } catch { return resolve(value); }
}

export function profileArgument(argv) {
  // Chromium takes the last supplied switch value; duplicate values must not
  // turn a different profile into a shutdown target.
  let value;
  for (let index = 1; index < argv.length; index++) {
    if (argv[index] === '--') break;
    if (argv[index].startsWith('--user-data-dir=')) value = argv[index].slice(16);
    else if (argv[index] === '--user-data-dir' && index + 1 < argv.length) value = argv[++index];
  }
  return value;
}

export function matchingBrowserProcesses(processes, app, profile) {
  const executable = normalizedPath(join(app, 'Contents/MacOS/Dia'));
  const userData = profile === undefined ? undefined : normalizedPath(join(profile, 'User Data'));
  return processes.filter((entry) => {
    const value = profileArgument(entry.argv);
    return normalizedPath(entry.executable) === executable ||
      (userData !== undefined && value !== undefined && isAbsolute(value) && normalizedPath(value) === userData);
  });
}

export function createProcessProbe() {
  if (process.platform !== 'darwin') throw new Error('Exact browser process inspection requires macOS.');
  const prebuilt = prebuiltHelper('process-info');
  const directory = prebuilt ? null : mkdtempSync(join(tmpdir(), 'dia-custom-process-guard-'));
  const executable = prebuilt ?? join(directory, 'process-info');
  const dispose = () => { if (directory) rmSync(directory, { recursive: true, force: true }); };
  try {
    if (!prebuilt) {
      execFileSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-O2',
        join(dirname(fileURLToPath(import.meta.url)), 'browser-process-info.c'), '-o', executable],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    }
  } catch (error) {
    dispose();
    throw new Error(`Cannot build exact browser process probe: ${error.stderr?.toString().trim() || error.message}`);
  }
  return {
    list() {
      try {
        return JSON.parse(execFileSync(executable, ['list'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
      } catch (error) {
        throw new Error(`Cannot verify browser processes: ${error.stderr?.toString().trim() || error.message}`);
      }
    },
    terminate(entry, rawProfile) {
      execFileSync(executable, ['signal', String(entry.pid), entry.startSeconds, entry.startMicroseconds,
        entry.executable, rawProfile], { stdio: ['ignore', 'pipe', 'pipe'] });
    },
    dispose,
  };
}

export async function stopProfileBrowser(probe, app, profile, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const executable = normalizedPath(join(app, 'Contents/MacOS/Dia'));
  const userData = normalizedPath(join(profile, 'User Data'));
  const deadline = Date.now() + timeoutMs;
  const signaled = new Set();
  while (true) {
    const users = probe.list().filter((entry) => {
      const value = profileArgument(entry.argv);
      if (value !== undefined && !isAbsolute(value) && normalizedPath(entry.executable) === executable) {
        throw new Error(`Cannot verify relative profile argument for process ${entry.pid}; preserving ${profile}`);
      }
      return value !== undefined && isAbsolute(value) && normalizedPath(value) === userData;
    });
    if (users.length === 0) return;
    for (const entry of users) {
      if (normalizedPath(entry.executable) !== executable) continue;
      const identity = `${entry.pid}:${entry.startSeconds}:${entry.startMicroseconds}`;
      if (signaled.has(identity)) continue;
      probe.terminate(entry, profileArgument(entry.argv));
      signaled.add(identity);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Profile is still in use by process(es) ${users.map(({ pid }) => pid).join(', ')}; preserving ${profile}`);
    }
    await setTimeout(intervalMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, app, profile, ...extra] = process.argv.slice(2);
    if (!['list', 'assert-stopped', 'stop-profile', 'assert-no-other-custom'].includes(command) || !app || extra.length ||
      (command === 'stop-profile' && !profile)) {
    process.stderr.write('usage: browser-process-guard.js {list|assert-stopped} APP [PROFILE] | stop-profile APP PROFILE\n');
    process.exitCode = 2;
  } else {
    let probe;
    try {
      probe = createProcessProbe();
      if (command === 'stop-profile') await stopProfileBrowser(probe, app, profile);
      else if (command === 'assert-no-other-custom') {
        const executable = normalizedPath(join(app, 'Contents/MacOS/Dia'));
        const other = probe.list().filter(entry => {
          if (!entry.executable.endsWith('/Contents/MacOS/Dia') ||
              normalizedPath(entry.executable) === executable) return false;
          try {
            const bundle = resolve(dirname(entry.executable), '../..');
            return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier',
              join(bundle, 'Contents/Info.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
              .trim() === 'local.rttm.dia';
          } catch { return false; }
        });
        if (other.length) throw new Error(`Close the other Dia+ instance(s) before native startup validation (process ${other.map(({pid}) => pid).join(', ')}).`);
      }
      else {
        const matches = matchingBrowserProcesses(probe.list(), app, profile);
        if (command === 'list') process.stdout.write(`${JSON.stringify(matches)}\n`);
        else if (matches.length) throw new Error(`Quit Dia Custom before continuing (process ${matches.map(({ pid }) => pid).join(', ')}).`);
      }
    } catch (error) {
      process.stderr.write(`Dia Custom: ${error.message}\n`);
      process.exitCode = 1;
    } finally {
      probe?.dispose();
    }
  }
}
