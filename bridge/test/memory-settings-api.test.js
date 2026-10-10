import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ConfigStore } from '../src/config.js';

test('real isolated Memory settings API requires administration and preserves saved choices', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-memory-api-'));
  const config = new ConfigStore(join(root, 'config.json'));
  const saved = await config.update({ version: 1, selectedModel: 'qa:qa', providers: [{
    id: 'qa', label: 'Offline QA', type: 'openai-compatible', api: 'chat-completions', enabled: true,
    baseURL: 'http://127.0.0.1:9/v1', models: [{ id: 'qa', label: 'QA' }],
  }], localMemory: { enabled: false, retentionDays: 7, profileRetentionDays: { Work: 30 } },
  localWeb: { enabled: false }, localConnectors: { enabled: false } });
  const listener = createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [new URL('../src/server.js', import.meta.url).pathname], {
    env: { ...process.env, DIA_CUSTOM_BRIDGE_PORT: String(port), DIA_CUSTOM_STATE_DIR: root,
      DIA_CUSTOM_PROFILE: join(root, 'profile'), DIA_CUSTOM_MODS: 'native-memory', DIA_CUSTOM_STAGING: '1',
      DIA_CUSTOM_CONFIG_PATH: config.path, DIA_CUSTOM_APPLE_MODEL_HELPER: join(root, 'absent-helper') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Consume output without storing provider payloads, tokens or fixture secrets.
  child.stdout.resume(); child.stderr.resume();
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close'); child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 4000);
      try { await closed; } finally { clearTimeout(timeout); }
    }
    await rm(root, { recursive: true, force: true });
  });
  const url = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let tries = 0; tries < 100; tries++) {
    if (child.exitCode !== null) throw new Error('Isolated Memory bridge exited before readiness');
    try { ready = (await fetch(url + '/health', { signal: AbortSignal.timeout(100) })).ok; } catch {}
    if (ready) break;
    await delay(50);
  }
  assert(ready, 'isolated server must become ready');
  const get = async () => (await fetch(url + '/api/memory/enabled')).json();
  const put = (path, body, token = saved.adminToken) => fetch(url + path, { method: 'PUT',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-dia-custom-token': token } : {}) }, body: JSON.stringify(body) });
  assert.equal((await get()).modEnabled, true);
  assert.equal((await get()).enabled, false, 'opening settings must preserve paused Memory');
  assert.equal((await put('/api/memory/enabled', { enabled: true }, null)).status, 403);
  assert.equal((await put('/api/memory/retention', { retentionDays: 14 }, 'wrong')).status, 403);
  assert.equal((await get()).enabled, false);
  assert.equal((await put('/api/memory/enabled', { enabled: 'yes' })).status, 400);
  assert.equal((await put('/api/memory/enabled', { enabled: true })).status, 200);
  assert.equal((await get()).enabled, true);
  assert.equal((await put('/api/memory/retention', { retentionDays: 14 })).status, 200);
  assert.deepEqual((await get()).profileRetentionDays, { Work: 30 });
  assert.equal((await put('/api/memory/enabled', { enabled: false })).status, 200);
  const paused = await get();
  assert.equal(paused.enabled, false); assert.equal(paused.retentionDays, 14);
  assert.equal(paused.stats.total, 0);
});
