import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedDownload, parseAppcast, requireAllMods, validateArchivePaths, verifyArchive } from '../src/updater-common.js';
import { CustomUpdater, handleUpdaterAPI } from '../src/custom-updater.js';
import { installTransaction } from '../src/update-worker.js';
const source = { distributionPrefix: 'https://releases.diabrowser.com/releases/', feedURL: 'https://releases.diabrowser.com/releases/feed.xml' };
test('candidate jobs discard live profile paths, credentials and runtime injection', t => {
  const keys = ['DIA_CUSTOM_MEMORY_PATH', 'DIA_CUSTOM_STATE_DIR', 'DIA_CUSTOM_CONFIG_PATH',
    'DIA_CUSTOM_CREDENTIALS_PATH', 'DIA_CUSTOM_HISTORY_PATH', 'DIA_CUSTOM_CAPTURE_DIR',
    'OPENAI_API_KEY', 'GH_TOKEN', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) {
    if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  } });
  for (const key of keys) process.env[key] = '/synthetic-live-profile-or-credential';
  const updater = new CustomUpdater({ bridgeDirectory: '/development/bridge', profileDirectory: '/synthetic-live-profile', stateDirectory: '/unused' });
  const { env } = updater.jobContext('/synthetic-job');
  for (const key of keys) assert.equal(env[key], undefined, key);
  assert.equal(env.DIA_CUSTOM_STAGING, '1');
  assert.equal(env.DIA_CUSTOM_WORK_DIR, '/synthetic-job/work');
  assert.equal(env.HOME, process.env.HOME);
});
const enclosure = (extra = '') => `<enclosure url="${source.distributionPrefix}Dia.zip" sparkle:version="86584" sparkle:shortVersionString="1.48.0 (86584)" length="4" sparkle:edSignature="${Buffer.alloc(64).toString('base64')}" ${extra}>`;
test('official feed selects full archives, bounds metadata and refuses foreign destinations', () => {
  assert.equal(parseAppcast(enclosure('sparkle:deltaFrom="86500"') + enclosure(), source).build, '86584');
  assert.throws(() => parseAppcast('<!DOCTYPE rss>' + enclosure(), source), /Unsafe/);
  assert.throws(() => parseAppcast(enclosure().replace('length="4"', 'length="9999999999"'), source), /metadata/);
  for (const url of ['https://evil.test/Dia.zip', 'http://releases.diabrowser.com/releases/Dia.zip', 'https://releases.diabrowser.com/releases/%2e%2e/a.zip', 'https://releases.diabrowser.com/releases/Dia.zip?redirect=1']) assert.throws(() => allowedDownload(url, source));
});
test('Ed25519 verification rejects altered bytes, keys, signatures and lengths', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const bytes = Buffer.from('data');
  const pinned = { publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
  const release = { length: 4, signature: sign(null, bytes, privateKey).toString('base64') };
  assert.doesNotThrow(() => verifyArchive(bytes, release, pinned));
  assert.throws(() => verifyArchive(Buffer.from('evil'), release, pinned), /signature/);
  assert.throws(() => verifyArchive(bytes, { ...release, length: 5 }, pinned), /length/);
});
test('archive traversal and any failed or omitted enabled mod block staging', () => {
  assert.doesNotThrow(() => validateArchivePaths('Dia.app/Contents/Info.plist\n__MACOSX/Dia.app/._x\n'));
  for (const path of ['/Dia.app/x', 'Dia.app/../evil', 'evil.app/x', 'Dia.app\\x']) assert.throws(() => validateArchivePaths(path));
  assert.throws(() => requireAllMods({ compatible: true, perMod: [{ id: 'a', compatible: true }] }, ['a','b']));
  assert.throws(() => requireAllMods({ compatible: false, perMod: [{ id: 'a', compatible: false }] }, ['a']));
  assert.doesNotThrow(() => requireAllMods({ compatible: false, perMod: [{ id: 'a', compatible: true }, { id: 'b', compatible: false }] }, ['a']));
  assert.throws(() => requireAllMods({ compatible: true, perMod: [{ id: 'a', compatible: true }, { id: 'b', compatible: false }] }, ['a']));
});
test('bounded update downloads report streamed byte progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dia-updater-progress-'));
  const output = join(directory, 'update.zip');
  const updater = new CustomUpdater({ bridgeDirectory: '/development/bridge', profileDirectory: null, stateDirectory: directory,
    isEnabled: () => true, modConfigStore: { publicState: async () => ({ mods: [] }) },
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from('ab')); controller.enqueue(Buffer.from('cd')); controller.close();
    } }), { status: 200, headers: { 'content-length': '4' } }),
  });
  const progress = [];
  try {
    assert.equal(await updater.fetchBounded(source.distributionPrefix + 'Dia.zip', source, 4, output, size => progress.push(size)), 4);
    assert.deepEqual(progress, [2, 4]);
    assert.equal(await readFile(output, 'utf8'), 'abcd');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('all updater administration endpoints require the local token', async () => {
  let called = false, result;
  const updater = { status: () => { called = true; } };
  await handleUpdaterAPI({ method: 'GET' }, {}, new URL('http://localhost/api/updater'), { updater, hasAdminToken: async () => false, jsonResponse: (_, code, value) => { result = { code, value }; } });
  assert.equal(result.code, 403); assert.equal(called, false);
});
test('the authenticated updater continuation endpoint resumes a reviewed update', async () => {
  let called = false, result;
  const updater = { continueWithoutIncompatible: async () => { called = true; return { phase: 'building' }; } };
  await handleUpdaterAPI({ method: 'POST' }, {}, new URL('http://localhost/api/updater/continue'), {
    updater, hasAdminToken: async () => true,
    jsonResponse: (_, code, value) => { result = { code, value }; },
  });
  assert.equal(called, true); assert.deepEqual(result, { code: 200, value: { phase: 'building' } });
});
test('development bridge cannot download/install an app', async () => {
  const updater = new CustomUpdater({ bridgeDirectory: '/development/bridge', profileDirectory: null, stateDirectory: '/unused', isEnabled: () => true, modConfigStore: { publicState: async () => ({ mods: [{ id: 'custom-updater', configuredEnabled: true }] }) } });
  await assert.rejects(() => updater.check(), /installed/);
});
async function fixture(fail) {
  const job = await mkdtemp(join(tmpdir(), 'dia-updater-rollback-'));
  const t = { job, toolkit: join(job, 'toolkit'), node: '/node', app: '/Applications/Dia Custom QA.app', candidate: join(job, 'candidate.app'), profile: join(job, 'profile'), env: {}, mods: ['a'], runtimeID: 'runtime', statePath: join(job, 'status.json') };
  const calls = [], moves = [], removals = [];
  const io = {
    authorize: async () => {},
    plist: async (_, key) => key === 'CFBundleIdentifier' ? 'local.rttm.dia' : 'runtime',
    mkdir: async () => {}, cp: async () => {}, stat: async () => ({}),
    rename: async (a,b) => { moves.push([a,b]); },
    rm: async (path) => { removals.push(path); },
    run: async (command,args) => {
      calls.push([command,args]);
      if (fail(command,args,calls)) throw new Error('injected failure');
      if (command === '/node' && args[0].endsWith('/mods.js')) return 'a';
      if (command === '/node' && args[0].endsWith('/browser-process-guard.js') && args[1] === 'list') return JSON.stringify([{ executable: `${t.app}/Contents/MacOS/Dia`, argv: [`${t.app}/Contents/MacOS/Dia`] }]);
      return '';
    },
  };
  return { t, io, calls, moves, removals };
}
test('cancelled app quit never swaps apps or copies a live profile', async () => {
  const f = await fixture(command => command.endsWith('/quit-app'));
  await assert.rejects(() => installTransaction(f.t, f.io), /injected/);
  assert.equal(f.moves.length, 0);
  assert.equal(f.calls.some(([cmd]) => cmd === '/bin/cp'), false);
  assert.equal(f.removals.length, 1);
  assert.equal(JSON.parse(await readFile(f.t.statePath)).phase, 'failed');
});
test('a remaining profile process blocks snapshots and app replacement after quit', async () => {
  const f = await fixture((command, args) => command === '/node' && args[0].endsWith('/browser-process-guard.js') && args[1] === 'assert-stopped' && args.length === 4);
  await assert.rejects(() => installTransaction(f.t, f.io), /injected/);
  assert.equal(f.moves.length, 0);
  assert.equal(f.calls.some(([command]) => command === '/bin/cp'), false);
  assert.equal(JSON.parse(await readFile(f.t.statePath)).phase, 'failed');
});
test('a staged preflight process preserves its app when shutdown cannot be verified', async () => {
  const f = await fixture((command, args) =>
    (command === '/bin/zsh' && args[0].endsWith('/preflight-profile.sh')) ||
    (command === '/node' && args[0].endsWith('/browser-process-guard.js') && args[1] === 'assert-stopped' && args.length === 3));
  await assert.rejects(() => installTransaction(f.t, f.io), /injected/);
  assert.equal(f.moves.length, 0);
  assert.equal(f.removals.length, 0);
  const state = JSON.parse(await readFile(f.t.statePath));
  assert.equal(state.phase, 'recovery-required');
  assert.match(state.rollbackError, /Staged app preserved/);
});
test('an empty exact-process health check rolls back an app that exited after launch', async () => {
  const f = await fixture(() => false);
  const run = f.io.run;
  f.io.run = async (command, args) => args[0]?.endsWith('/browser-process-guard.js') && args[1] === 'list' ? '[]' : run(command, args);
  await assert.rejects(() => installTransaction(f.t, f.io), /browser exited/);
  assert.ok(f.moves.some(([from, to]) => from.includes('.dia-custom-backups/') && to === f.t.app));
  assert.ok(f.moves.some(([from]) => from === f.t.profile));
});
test('failed post-swap launch restores the paired app and complete profile', async () => {
  let launches = 0;
  const f = await fixture((command,args) => command === '/bin/zsh' && args[0].endsWith('/launch.sh') && ++launches === 1);
  await assert.rejects(() => installTransaction(f.t, f.io), /injected/);
  assert.ok(f.moves.some(([a,b]) => a.includes('.dia-custom-backups/') && b === f.t.app));
  assert.ok(f.moves.some(([a,b]) => a === f.t.profile && b.startsWith(f.t.profile + '.failed-update-')));
  assert.ok(f.calls.some(([cmd,args]) => cmd === '/bin/cp' && args.at(-1) === f.t.profile));
  assert.equal(launches, 2);
  assert.equal(JSON.parse(await readFile(f.t.statePath)).rollbackError, null);
});
test('successful staged install retains recovery pointers and records completion', async () => {
  const f = await fixture(() => false);
  await installTransaction(f.t, f.io);
  const state = JSON.parse(await readFile(f.t.statePath));
  assert.equal(state.phase, 'installed'); assert.ok(state.backupApp); assert.ok(state.profileSnapshot);
  assert.equal(f.moves.some(([,b]) => b.startsWith(f.t.profile + '.failed-update-')), false);
});
test('a partial staged install compares the profile with requested rather than effective mods', async () => {
  const f = await fixture(() => false);
  f.t.requestedMods = ['a', 'optional'];
  const run = f.io.run;
  f.io.run = async (command, args) => command === '/node' && args[0].endsWith('/mods.js')
    ? 'a,optional'
    : run(command, args);
  await installTransaction(f.t, f.io);
  assert.equal(JSON.parse(await readFile(f.t.statePath)).phase, 'installed');
});
test('worker rechecks access before closing and before replacement; revocation never swaps the app', async () => {
  for (const failAt of [1, 2]) {
    const f = await fixture(() => false); let checks = 0;
    f.io.authorize = async () => { if (++checks === failAt) throw new Error('Repository access revoked'); };
    await assert.rejects(installTransaction(f.t, f.io), /revoked/);
    assert.equal(f.moves.length, 0);
    if (failAt === 1) assert.equal(f.calls.some(([cmd]) => cmd.endsWith('/quit-app')), false);
    else assert(f.calls.some(([cmd, args]) => cmd === '/bin/zsh' && args[0].endsWith('/launch.sh')));
    assert.equal(JSON.parse(await readFile(f.t.statePath)).phase, 'failed');
  }
});
