#!/usr/bin/env node
// Owner-approved temporary native QA. Always attempts to reopen the normal app.
import { execFileSync, spawn } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { createProcessProbe, stopProfileBrowser } from '../../scripts/browser-process-guard.js';
import { stopBundledBridge } from '../../scripts/bridge-runtime.js';
import { requireResearchCopy } from './research-copy-guard.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { root, test } = await requireResearchCopy(process.argv[2]);
const normal = '/Applications/Dia+.app';
let closed = false, browser, bridge, fixture;
let restart = false, paused = false, launchBrowser, refreshBridge;
let resolveFinish;
const finish = new Promise(resolve => { resolveFinish = resolve; });
const input = createInterface({ input: process.stdin });
input.on('line', async line => {
  if (line.trim() === 'finish') resolveFinish();
  if (line.trim() === 'pause' && launchBrowser && !restart) {
    restart = true;
    const probe = createProcessProbe();
    try { await stopProfileBrowser(probe, test.app, test.profile); paused = true; console.log('Research browser paused; fixture bridge remains isolated.'); }
    catch (error) { console.error(error.message); resolveFinish(); }
    finally { probe.dispose(); restart = false; }
  }
  if (line.trim() === 'restart' && launchBrowser && !restart) {
    restart = true;
    const probe = createProcessProbe();
    try { if (!paused) await stopProfileBrowser(probe, test.app, test.profile); paused = false; launchBrowser(); console.log('Research browser restarted.'); }
    catch (error) { console.error(error.message); resolveFinish(); }
    finally { probe.dispose(); restart = false; }
  }
  if (line.trim() === 'bridge' && paused && refreshBridge && !restart) {
    restart = true;
    try { await refreshBridge(); console.log('Isolated bridge refreshed.'); }
    catch (error) { console.error(error.message); resolveFinish(); }
    finally { restart = false; }
  }
});
process.on('SIGINT', resolveFinish);
process.on('SIGTERM', resolveFinish);
const timeout = setTimeout(resolveFinish, 15 * 60_000);
const log = await open(join(root, 'process.log'), 'a', 0o600);
try {
  fixture = spawn(process.execPath, [join(repo, 'research/tools/browser-use-fixture.js'), root], { stdio: ['ignore', log.fd, log.fd] });
  await delay(500);
  if (!fixture.pid || fixture.exitCode !== null) throw new Error('Local fixture did not start.');
  closed = true;
  try {
    execFileSync(join(normal, 'Contents/Resources/DiaCustomUpdater/prebuilt/quit-app'), [normal], { timeout: 50_000 });
  } catch (error) {
    // Some macOS previews retain a stale NSRunningApplication.isTerminated.
    // Accept only the timed-out observation, with independently proven shutdown.
    if (error.status !== 3) throw error;
    execFileSync(process.execPath, [join(repo, 'scripts/browser-process-guard.js'), 'assert-stopped', normal]);
  }
  execFileSync(process.execPath, [join(repo, 'scripts/browser-process-guard.js'), 'assert-stopped', normal]);
  await stopBundledBridge(normal);
  const env = { ...process.env, DIA_CUSTOM_PROFILE: test.profile, DIA_CUSTOM_STATE_DIR: join(test.profile, 'Bridge/.state'),
    DIA_CUSTOM_MODS: test.mods, DIA_CUSTOM_STAGING: '1',
    DIA_CUSTOM_RUNTIME_ID: 'browser-use-research-87864', DIA_CUSTOM_PREFLIGHT: '1' };
  // Prevent inherited launcher state from pointing the fixture at real profile files.
  for (const key of Object.keys(env)) if (key.startsWith('DIA_CUSTOM_') && !['DIA_CUSTOM_PROFILE', 'DIA_CUSTOM_STATE_DIR', 'DIA_CUSTOM_MODS', 'DIA_CUSTOM_STAGING', 'DIA_CUSTOM_CAPTURE', 'DIA_CUSTOM_RUNTIME_ID', 'DIA_CUSTOM_PREFLIGHT'].includes(key)) delete env[key];
  delete env.DIA_CUSTOM_CAPTURE;
  bridge = spawn(join(test.app, 'Contents/Helpers/DiaCustomNode'), [join(test.app, 'Contents/Resources/DiaCustomBridge/src/server.js')], { env, stdio: ['ignore', log.fd, log.fd] });
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const health = await (await fetch('http://127.0.0.1:8765/health')).json();
      if (health.runtimeID === env.DIA_CUSTOM_RUNTIME_ID && health.profileDirectory === test.profile && health.coreReady === true) { healthy = true; break; }
    } catch {}
    await delay(100);
  }
  if (!healthy) throw new Error('Isolated bridge did not become ready; no native launch.');
  refreshBridge = async () => {
    const { test: next } = await requireResearchCopy(root);
    if (next.app !== test.app || next.profile !== test.profile || !next.bakedIsolation) throw new Error('Research isolation changed');
    env.DIA_CUSTOM_MODS = next.mods;
    if (bridge.exitCode === null && bridge.signalCode === null) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Research bridge did not stop within five seconds')), 5000);
      bridge.once('exit', () => { clearTimeout(timer); resolve(); });
      bridge.kill('SIGTERM');
    });
    bridge = spawn(join(test.app, 'Contents/Helpers/DiaCustomNode'), [join(test.app, 'Contents/Resources/DiaCustomBridge/src/server.js')], { env, stdio: ['ignore', log.fd, log.fd] });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const health = await (await fetch('http://127.0.0.1:8765/health')).json();
        if (health.runtimeID === env.DIA_CUSTOM_RUNTIME_ID && health.profileDirectory === test.profile && health.coreReady) return;
      } catch {}
      await delay(100);
    }
    throw new Error('Refreshed research bridge did not become ready');
  };
  const configScript = await readFile(join(repo, 'scripts/configure-profile.sh'), 'utf8');
  const flags = [...new Set([...configScript.matchAll(/"([a-z0-9-]+=(?:true|false))"/g)].map(match => match[1]))];
  // Dia's native reader accepts one pipe-delimited String, not an NSArray.
  const argumentFlags = (test.flags ?? flags).join('|');
  launchBrowser = () => {
  browser = spawn(join(test.app, 'Contents/MacOS/Dia'), [
    '-customApplicationDataBaseURLPath', test.profile,
    '-transientFeatureFlagOverrides', argumentFlags,
    '-onboardingForceCompleteFlowEnabled', 'NO', '-hasPresentedOnboardingIntro', 'YES',
    '-hasUserAuthenticated', 'YES', '-onboardingRemainingSteps', '()',
    '-shouldShareUsageData', 'NO', '-firebaseSyncEnabled', 'NO', '-cloudKitSyncEnabled', 'NO',
    '--user-data-dir=' + join(test.profile, 'User Data'), '--remote-debugging-port=19223',
    '--no-first-run', '--disable-sync', '--disable-component-update', '--disable-background-networking',
    '--use-mock-keychain', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    'http://localhost:18865/qa',
  ], { env, stdio: ['ignore', log.fd, log.fd] });
  browser.once('exit', () => { if (!restart) { console.log('Research browser exited.'); resolveFinish(); } });
  };
  launchBrowser();
  console.log('Research app ready: ' + test.app + '\nOnly fresh local fixtures are loaded. Enter finish to restore the normal session.');
  await finish;
} finally {
  clearTimeout(timeout); input.close();
  if (browser?.pid) {
    const probe = createProcessProbe();
    try { await stopProfileBrowser(probe, test.app, test.profile); }
    catch (error) { console.error('Research cleanup failed: ' + error.message); closed = false; }
    finally { probe.dispose(); }
  }
  if (bridge?.pid) bridge.kill('SIGTERM');
  if (fixture?.pid) fixture.kill('SIGTERM');
  await delay(500);
  await log.close();
  if (closed) {
    execFileSync('/usr/bin/open', ['-a', normal]);
    console.log('Normal Dia+ reopened. Test evidence preserved at ' + root);
  }
}
