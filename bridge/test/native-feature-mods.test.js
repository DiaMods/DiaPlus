import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ModConfigStore } from '../src/mod-config.js';
import { normalizeAnthropicTools, deferredAnthropicTools, nativeToolSearchTool } from '../src/chat-shape.js';
import { authorizeNativeToolCalls } from '../src/artifact-safety.js';

const manifestPath = new URL('../config/dia-mods.json', import.meta.url);
const ids = ['workspaces-spaces', 'chat-controls', 'split-view-refinements', 'browser-use-tasks'];

test('four native research references are not usable mods and remain optional and default-off', async () => {
  const manifest = JSON.parse(await readFile(manifestPath));
  for (const id of ids) {
    const mod = manifest.mods.find(mod => mod.id === id);
    assert(mod); assert.equal(mod.defaultEnabled, false); assert.equal(mod.required, false);
    assert.equal(mod.experimental, true); assert.equal(mod.availability, 'pending-audit');
    assert.equal(mod.researchOnly, true);
    assert.match(mod.description, /Research reference only, not a usable mod/);
    assert.deepEqual(mod.auditedBuilds, []);
    assert(mod.nativeFeatureFlags.length > 0);
  }
  const flags = ids.flatMap(id => manifest.mods.find(mod => mod.id === id).nativeFeatureFlags);
  assert.equal(new Set(flags).size, flags.length, 'Feature groups must not share flags');
});

test('pending audits cannot be activated through the mod API or stale saved overrides', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-native-feature-mods-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = join(root, 'mods.json');
  await writeFile(statePath, JSON.stringify({ version: 1, overrides: Object.fromEntries(ids.map(id => [id, true])) }));
  const store = new ModConfigStore({ manifestPath, statePath, legacyStatePath: join(root,'legacy.json'), compatibilityPath: join(root,'compatibility.json'), activeModIDs: ids });
  const state = await store.publicState();
  for (const id of ids) {
    const mod = state.mods.find(mod => mod.id === id);
    assert.equal(mod.unavailable, true); assert.equal(mod.active, false); assert.equal(mod.pending, false);
    await assert.rejects(store.setEnabled(id, true), /audited|auditing|investigation|tested|approved/i);
  }
  assert.equal((await store.setEnabled('browser-use-tasks', false)).mods.find(mod => mod.id === 'browser-use-tasks').configuredEnabled, false);
});

test('CLI and bridge environment selections cannot bypass the audit gate', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'dia-native-features-cli-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const root = new URL('../../', import.meta.url);
  const env = { ...process.env, DIA_CUSTOM_MODS: ids.join(',') };
  delete env.DIA_CUSTOM_MODULES;
  assert.equal(execFileSync(process.execPath, ['scripts/mods.js','resolved','--profile',profile], { cwd: root, env, encoding:'utf8' }).trim(), 'identity-isolation,network-isolation,update-blocker,local-ai-routing');
  for (const id of ids) assert.throws(() => execFileSync(process.execPath, ['scripts/mods.js','enable',id,'--profile',profile], { cwd: root, env, stdio:'pipe' }));
  const output = execFileSync(process.execPath, ['--input-type=module','-e',`import {modEnabled,enabledModIDs} from './bridge/src/mods.js'; console.log(JSON.stringify({enabled:${JSON.stringify(ids)}.map(modEnabled),ids:enabledModIDs()}));`], { cwd:root, env, encoding:'utf8' });
  assert.deepEqual(JSON.parse(output), {enabled:[false,false,false,false],ids:[]});
  delete env.DIA_CUSTOM_MODS;
  const defaults = execFileSync(process.execPath, ['--input-type=module','-e',`import {modEnabled} from './bridge/src/mods.js'; console.log(JSON.stringify(${JSON.stringify(ids)}.map(modEnabled)));`], {cwd:root,env,encoding:'utf8'});
  assert.deepEqual(JSON.parse(defaults),[false,false,false,false]);
});

test('disabled browser/task tools cannot leak through loaded schemas, ToolSearch or final native dispatch', async () => {
  const names = ['browser_use', 'mcp__dia-tools__browser_use', 'update_task_user_preferences', 'mcp__dia-tools__update_task_user_preferences'];
  const payload = { tools: [...names, 'read_tabs'].map(name => ({name,input_schema:{type:'object'}})), system:
    `<system-reminder>The following deferred tools are now available\nLoad their schemas before calling them:\n${[...names,'read_tabs'].join('\n')}\n</system-reminder>` };
  assert.deepEqual(normalizeAnthropicTools(payload).map(tool => tool.name), ['read_tabs']);
  assert.equal(normalizeAnthropicTools(payload,{includeBlocked:true}).length, 5);
  assert(deferredAnthropicTools(payload).filter(tool=>names.includes(tool.name)).every(tool=>tool.source==='blocked'));
  assert(nativeToolSearchTool(payload));
  assert.equal(nativeToolSearchTool({...payload,system:payload.system.replace('\nread_tabs','')}),null);
  const calls = names.map(name=>({name,input:{code:'output("fixture")'}}));
  const result = await authorizeNativeToolCalls(calls, '/nonexistent/isolated-profile');
  assert.equal(result.allowed.length,0); assert.equal(result.blocked.length,4);
  assert(result.blocked.every(entry=>/disabled|audit/.test(entry.reason)));
});
