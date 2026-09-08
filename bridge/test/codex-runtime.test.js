import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionCodex, decisionConfigOverrides } from '../src/providers/codex-runtime.js';
test('Codex decision runtime disables inherited MCP servers by real CLI key paths', async () => {
  let options, invocation;
  await createDecisionCodex({ executable: async () => '/official/codex', execute: async (file,args,opts) => { invocation={file,args,opts};return {stdout:JSON.stringify([{name:'fixture-tools'},{name:'docs'}])}; }, CodexClient:class {constructor(value){options=value;}} });
  assert.equal(options.codexPathOverride,'/official/codex');
  assert.ok(options.configOverrides.includes('mcp_servers.fixture-tools.enabled=false'));
  assert.ok(options.configOverrides.includes('mcp_servers.docs.required=false'));
  assert.equal(options.configOverrides.some(value=>value.includes('"fixture-tools"')),false,'CLI dotted key parser does not decode quoted components');
  for (const name of ['shell_tool','apps','plugins','multi_agent','hooks','computer_use','browser_use']) assert.ok(options.configOverrides.includes(`features.${name}=false`));
  assert.deepEqual(invocation.args.slice(-3),['mcp','list','--json']);
  assert.equal(invocation.opts.env.OPENAI_API_KEY,undefined);
  assert.equal(invocation.opts.env.DIA_CUSTOM_STATE_DIR,undefined);
});
test('Codex refuses unreadable/unsafe inventories before starting a model request', async () => {
  let created=false;
  await assert.rejects(()=>createDecisionCodex({executable:async()=>'/official/codex',execute:async()=>({stdout:'{}'}),CodexClient:class {constructor(){created=true;}}}),/invalid MCP inventory/);
  assert.equal(created,false);
  assert.throws(()=>decisionConfigOverrides([{name:'bad.name'}]),/safely disabled/);
});
