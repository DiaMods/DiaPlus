import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handoffInstaller, installerArguments, installerIsRunning, installerService } from '../src/installer-handoff.js';

test('macOS installer is a one-shot independent service with escaped paths and no credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-installer-handoff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const transaction = { job: root, toolkit: join(root, 'toolkit'), node: '/path with spaces/<Node>&', env: {
    PATH: '/usr/bin:/bin', HOME: '/Users/qa', DIA_CUSTOM_STAGING: '1', GH_TOKEN: 'must-not-leak',
    OPENAI_API_KEY: 'must-not-leak', DIA_CUSTOM_CONFIG_PATH: '/private/config',
  } };
  const calls = [];
  const service = await handoffInstaller(transaction, { uid: 501, runImpl: async (...args) => calls.push(args) });
  assert.deepEqual(calls[0].slice(0, 2), ['/bin/launchctl', ['bootstrap', 'gui/501', service.path]]);
  const xml = await readFile(service.path, 'utf8');
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key><false\/>/);
  assert.match(xml, /--launchd-worker/);
  assert.match(xml, /&lt;Node&gt;&amp;/);
  assert.doesNotMatch(xml, /must-not-leak|GH_TOKEN|OPENAI|CONFIG_PATH/);
  assert.equal((await stat(service.path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, 'install.log'))).mode & 0o777, 0o600);
  assert.notEqual(installerService(root, 501).label, installerService(root + '-other', 501).label);
  await assert.rejects(handoffInstaller(transaction, { uid: 501, runImpl: async () => {} }), /EEXIST/);
});

test('queued services without a PID remain active and completed services are recoverable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-installer-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const transaction = { job: root, toolkit: join(root, 'toolkit'), node: '/runtime/node' };
  await writeFile(installerService(root, 501).path, '<plist/>');
  const inspect = info => installerIsRunning(transaction, { platform: 'darwin', uid: 501,
    runImpl: async command => command === '/bin/ps' ? '' : info });
  assert.equal(await inspect('\n state = waiting\n runs = 0\n'), true);
  assert.equal(await inspect('\n state = waiting\n runs = 1\n last exit code = 0\n'), false);
  assert.equal(await inspect('\n state = waiting\n runs = 1\n last exit code = 9\n'), false);
  await assert.rejects(inspect('\n state = running\n pid = 123\n'), /identity cannot be confirmed/);
  const target = join(root, 'preserved'); await writeFile(target, 'unchanged');
  await symlink(target, join(root, 'install.log'));
  await assert.rejects(handoffInstaller(transaction, { uid: 501, runImpl: async () => {} }));
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
});

test('installer liveness matches exact job/executable/argv and fails closed on inspection failure', async () => {
  const t = { job: '/tmp/job with spaces', toolkit: '/tmp/job with spaces/toolkit', node: '/runtime/node' };
  const args = installerArguments(t).join(' ');
  const inspect = async text => installerIsRunning(t, { runImpl: async () => text });
  assert.equal(await inspect(` 123 ${args}\n`), true);
  assert.equal(await inspect(` 123 ${installerArguments(t, false).join(' ')}\n`), true);
  for (const decoy of [` 1 ${args}`, ` 123 /echo ${args}`, ` 123 ${args} --foreign`, '123 node another-job']) {
    assert.equal(await inspect(decoy), false);
  }
  await assert.rejects(installerIsRunning(t, { runImpl: async () => { throw Error('unavailable'); } }), /unavailable/);
  assert.throws(() => installerService('../relative', 501), /identity/);
  assert.throws(() => installerArguments({ ...t, toolkit: '/foreign' }), /paths/);
});
