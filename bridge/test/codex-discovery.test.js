import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { discoverCodexModels } from '../src/providers/codex-runtime.js';
import { ProviderManager } from '../src/provider-manager.js';

function fixture(pages, { hang = false } = {}) {
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = child.signalCode = null;
  child.kill = signal => { child.signalCode = signal; child.emit('exit'); return true; };
  child.stdin = new Writable({ write(buffer, _encoding, callback) {
    const request = JSON.parse(buffer.toString());
    requests.push(request);
    if (!hang && request.id) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id,
      result: request.method === 'initialize' ? {} : pages.shift() }) + '\n'));
    callback();
  } });
  return { child, requests, options: { executable: async () => '/local/codex', execute: async () => ({ stdout: '[]' }), spawnImplementation: (_file, args) => {
    assert.equal(args.at(-1), 'app-server');
    assert.ok(args.includes('features.apps=false'));
    return child;
  } } };
}

test('model discovery follows cursors and uses returned IDs, labels, efforts and defaults', async () => {
  const f = fixture([
    { data: [{ id: 'entry', model: 'future-model', displayName: 'Future Model', isDefault: true, defaultReasoningEffort: 'future-effort', supportedReasoningEfforts: [{ reasoningEffort: 'future-effort' }] }], nextCursor: 'page-two' },
    { data: [{ model: 'another-new-model', displayName: 'New Model' }, { model: 'hidden-model', hidden: true }], nextCursor: null },
  ]);
  const models = await discoverCodexModels(f.options);
  assert.deepEqual(models.map(model => model.id), ['future-model', 'another-new-model']);
  assert.equal(models[0].defaultReasoningEffort, 'future-effort');
  assert.equal(models[0].label, 'Future Model');
  assert.equal(models[0].isDefault, true);
  assert.deepEqual(f.requests.map(request => request.method), ['initialize', 'initialized', 'model/list', 'model/list']);
  assert.equal(f.requests.at(-1).params.cursor, 'page-two');
  assert.equal(f.requests.at(-1).params.includeHidden, false);
  assert.equal(f.child.signalCode, 'SIGTERM');
});

test('model discovery rejects malformed pagination and times out with cleanup', async () => {
  const f = fixture([{ data: [], nextCursor: 'repeat' }, { data: [], nextCursor: 'repeat' }]);
  await assert.rejects(discoverCodexModels(f.options), /pagination/);
  assert.equal(f.child.signalCode, 'SIGTERM');
  const hanging = fixture([], { hang: true });
  await assert.rejects(discoverCodexModels({ ...hanging.options, timeout: 20 }), /timed out/);
  assert.equal(hanging.child.signalCode, 'SIGTERM');
});

test('Codex picker ignores legacy configured lists and disables cached models on discovery failure', async () => {
  let fail = false;
  const manager = new ProviderManager({ codexDiscoveryImplementation: async () => {
    if (fail) throw new Error('offline');
    return [{ id: 'new-live-model', label: 'New Live Model', isDefault: true }];
  } });
  const provider = { id: 'codex', type: 'codex', label: 'Codex', enabled: true, models: [{ id: 'obsolete-hardcoded-model' }] };
  const records = await manager.discoverProvider(provider);
  assert.deepEqual(records.map(model => model.key), ['codex:new-live-model']);
  manager.catalogValue = { models: records };
  fail = true;
  const cached = await manager.discoverProvider(provider);
  assert.equal(cached[0].available, false);
  assert.match(cached[0].reason, /offline/);
});
