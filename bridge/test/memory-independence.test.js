import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

// Fresh subprocesses exercise the production mod gate, not the test runner's
// historical default-all behavior. No native settings code or cloud provider
// is loaded; every database, source and provider response is synthetic/local.
async function scenario(src, root, enabled) {
  const { default: assert } = await import('node:assert/strict');
  const { mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { ConfigStore } = await import(src + 'config.js');
  const { CredentialStore } = await import(src + 'credentials.js');
  const { MemoryStore } = await import(src + 'local-tools/memory.js');
  const { ProviderManager } = await import(src + 'provider-manager.js');
  const { ToolCoverageStore } = await import(src + 'tool-coverage.js');
  const historyPath = join(root, 'User Data/Default/History');
  await mkdir(join(root, 'User Data/Default'), { recursive: true });
  const history = new DatabaseSync(historyPath);
  history.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,last_visit_time INTEGER)');
  const addHistory = marker => history.prepare('INSERT INTO urls(url,title,visit_count,last_visit_time) VALUES(?,?,?,?)')
    .run('https://example.com/' + marker, marker, 1, (BigInt(Date.now()) + 11644473600000n) * 1000n);
  addHistory('cobalt-project-history');
  const config = new ConfigStore(join(root, 'config.json'));
  await config.update({ version: 1, selectedModel: 'qa:qa', providers: [{
    id: 'qa', type: 'openai-compatible', api: 'chat-completions', enabled: true,
    label: 'Local test', baseURL: 'http://127.0.0.1:9/v1', models: [{ id: 'qa', label: 'QA' }],
  }], localMemory: { enabled: true, deriveMemories: false, excludedHosts: ['excluded.example'] },
  localWeb: { enabled: false }, localConnectors: { enabled: false } });
  const path = join(root, 'memory.sqlite3');
  const memory = new MemoryStore(path, historyPath);
  await memory.recordConversation({ messages: [{ role: 'user', content: 'I am working on the cobalt hummingbird project.' }] },
    { kind: 'final', text: 'The project is local.' });
  await memory.derivePending(batch => ({ memories: [{ text: 'The user is working on the cobalt hummingbird project.',
    title: 'Cobalt hummingbird', kind: 'project', confidence: 0.98, sourceUris: [batch.entries[0].uri] }] }));
  const seededCount = (await memory.stats()).total;
  const manager = new ProviderManager({ configStore: config, memoryStore: memory,
    credentialStore: new CredentialStore(join(root, 'credentials.json')),
    catalogPath: join(root, 'models.json'), toolCoverageStore: new ToolCoverageStore(join(root, 'tools.json')),
    appsStateStore: { load: async () => {} }, connectorRegistry: {},
    fetchImplementation: async () => new Response(JSON.stringify({ data: [{ id: 'qa' }] })),
  });
  let shownTools = [], recalled = false, derivations = 0;
  manager.runProvider = async (_provider, { payload, tools }) => {
    shownTools = tools.map(tool => tool.name);
    const text = JSON.stringify(payload.system ?? '');
    if (text.includes('You maintain private, local browser Memories')) {
      derivations++;
      const batch = JSON.parse(payload.messages[0].content[0].text);
      return { kind: 'final', text: JSON.stringify({ memories: [{ text: 'The user works on the cobalt hummingbird project.',
        title: 'Cobalt project', kind: 'project', confidence: 0.95, sourceUris: [batch.entries[0].uri] }] }), toolCalls: [] };
    }
    recalled = text.includes('local-memory-context') && text.includes('cobalt hummingbird');
    return { kind: 'final', text: 'The cobalt hummingbird project is remembered locally.', toolCalls: [], model: 'qa' };
  };
  const run = (text, metadata = {}) => manager.run({ messages: [{ role: 'user', content: text }], tools: [], metadata });
  try {
    await manager.initialize();
    await manager.catalogRefreshPromise;
    if (enabled) {
      // Pause before the delayed startup import: it must observe the saved
      // choice rather than its earlier enabled configuration snapshot.
      await manager.setLocalMemoryEnabled(false);
      await new Promise(resolve => setTimeout(resolve, 1100));
      await manager.historyImportPromise;
      assert.equal((await memory.search({ query: 'cobalt-project-history' })).results.length, 0);
      const current = await config.load();
      await config.update({ ...current, localMemory: { ...current.localMemory, enabled: true } });
    }
    clearTimeout(manager.historyImportTimer);
    manager.compatibility = { build: '88564', perMod: [{ id: 'native-memory', compatible: true, nativeSettingsDetected: false }] };
    assert.equal(await manager.refreshLocalMemory(await config.load()), enabled ? 1 : 0);
    await run('What is my cobalt hummingbird project?');
    assert.equal(recalled, enabled);
    assert.equal(shownTools.includes('mcp__dia-tools__memory_search'), enabled);
    assert.equal((await memory.stats()).total > seededCount, enabled);
    const afterChat = (await memory.stats()).total;
    await run('private-compatibility-marker', { incognito: true });
    assert.equal(recalled, false);
    assert.equal((await memory.stats()).total, afterChat);
    await run('What is my cobalt hummingbird project?', { profileID: 'Work' });
    assert.equal(recalled, false, 'another profile must not receive the saved Memory');
    if (enabled) {
      const found = await manager.localTools.execute({ name: 'mcp__dia-tools__memory_search', input: { query: 'cobalt hummingbird' } }, { profileID: 'Default' });
      assert(found.results.length > 0);
      await manager.setLocalMemoryEnabled(false);
      const pausedCount = (await memory.stats()).total;
      addHistory('paused-history-marker');
      assert.equal(await manager.refreshLocalMemory(await config.load()), 0);
      await run('paused-chat-marker');
      assert.equal(recalled, false);
      assert(!shownTools.includes('mcp__dia-tools__memory_search'));
      assert.equal((await memory.stats()).total, pausedCount);
      await assert.rejects(manager.localTools.execute({ name: 'mcp__dia-tools__memory_search', input: {} }), /local memory is disabled/);
      await manager.setLocalMemoryEnabled(true);
      assert((await memory.search({ query: 'paused-history-marker' })).results.length > 0);
      const current = await config.load();
      await config.update({ ...current, localMemory: { ...current.localMemory, deriveMemories: true } });
    } else {
      await assert.rejects(manager.setLocalMemoryEnabled(true), /mod is disabled/);
      await assert.rejects(manager.setLocalMemoryRetention(14), /mod is disabled/);
      await assert.rejects(manager.localTools.execute({ name: 'mcp__dia-tools__memory_search', input: {} }), /mod is disabled/);
      const current = await config.load();
      await config.update({ ...current, localMemory: { ...current.localMemory, deriveMemories: true } });
    }
    manager.memoryDerivationProfiles.add('Default');
    await manager.drainMemoryDerivations();
    assert.equal(derivations > 0, enabled, 'a disabled mod must not send queued Memory sources to the provider');
    const saved = await memory.stats();
    memory.database.close();
    const reopened = new MemoryStore(path, historyPath);
    assert.equal((await reopened.stats()).total, saved.total);
    assert((await reopened.automaticContext('cobalt hummingbird project')).memories.length > 0);
    reopened.database.close();
  } finally {
    clearTimeout(manager.historyImportTimer); clearTimeout(manager.memoryDerivationTimer); clearInterval(manager.historyRefreshTimer);
    await manager.catalogRefreshPromise;
    await manager.knowledgeStore.close();
    history.close();
  }
}

for (const enabled of [true, false]) {
  test(`bridge-owned Memory without native settings: mod ${enabled ? 'enabled' : 'disabled'}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dia-memory-independent-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const code = `await (${scenario.toString()})(${JSON.stringify(new URL('../src/', import.meta.url).href)},${JSON.stringify(root)},${enabled});`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, DIA_CUSTOM_MODS: enabled ? 'native-memory' : 'local-web', DIA_CUSTOM_STATE_DIR: root, DIA_CUSTOM_PROFILE: root },
      timeout: 30000,
    });
    assert.doesNotMatch(stdout, /Error/);
  });
}
