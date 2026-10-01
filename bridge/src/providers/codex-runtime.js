import { Codex } from '@openai/codex-sdk';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { join } from 'node:path';
const exec = promisify(execFile);
const environment = Object.fromEntries([
  'HOME','LANG','LC_ALL','LOGNAME','PATH','SHELL','TERM','TMPDIR','USER',
].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
export const decisionOnlyFeatures = {
  shell_tool: false, unified_exec: false, apps: false, plugins: false,
  multi_agent: false, multi_agent_v2: false, hooks: false, memories: false,
  code_mode: false, browser_use: false, browser_use_external: false,
  computer_use: false, image_generation: false, view_image: false,
  skill_search: false, skip_host_skill_discovery: true, tool_suggest: false,
  sleep_tool: false, workspace_dependencies: false,
};
export function decisionConfigOverrides(servers) {
  return [
    ...Object.entries(decisionOnlyFeatures).map(([name,enabled]) => `features.${name}=${enabled}`),
    'project_doc_max_bytes=0', 'history.persistence="none"',
    ...servers.flatMap(server => {
      if (typeof server.name !== 'string' || !server.name || server.name.length > 200) throw new Error('Invalid Codex MCP configuration');
      if (!/^[a-zA-Z0-9_-]+$/.test(server.name)) throw new Error('Codex MCP identifiers containing punctuation cannot be safely disabled by this CLI version');
      const key = server.name;
      return [`mcp_servers.${key}.enabled=false`, `mcp_servers.${key}.required=false`];
    }),
  ];
}
export async function codexExecutable() {
  const candidates = [process.env.DIA_CUSTOM_CODEX_BINARY,
    '/Applications/Codex.app/Contents/Resources/codex',
    process.env.HOME && join(process.env.HOME, 'Applications/Codex.app/Contents/Resources/codex'),
    // launchd does not inherit the interactive shell's PATH. Prefer the user's
    // current CLI over a potentially older system-wide Homebrew installation.
    process.env.HOME && join(process.env.HOME, '.local/bin/codex'),
    ...[...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin']
      .filter(path => path.startsWith('/')).map(path => join(path, 'codex'))];
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* next local installation */ }
  }
  throw new Error('Install and sign in to Codex on this Mac to use the Codex provider. Dia+ uses your local Codex installation.');
}
async function decisionRuntime(executable, execute) {
  const binary = await executable();
  const base = decisionConfigOverrides([]);
  // An empty TOML table merges with user configuration; it does not remove its
  // MCP servers. Enumerate names without starting servers, then disable each.
  let inventory;
  try {
    const { stdout } = await execute(binary, [...base.flatMap(value => ['--config',value]), 'mcp','list','--json'], { env: environment, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    inventory = JSON.parse(stdout);
  } catch(error) {
    throw new Error('Codex could not load its login/configuration. Update your local Codex installation. ' + String(error.message).slice(0,800));
  }
  if (!Array.isArray(inventory)) throw new Error('Codex returned an invalid MCP inventory');
  return { binary, overrides: decisionConfigOverrides(inventory) };
}
export async function createDecisionCodex({ executable = codexExecutable, execute = exec, CodexClient = Codex } = {}) {
  const { binary, overrides } = await decisionRuntime(executable, execute);
  return new CodexClient({ codexPathOverride: binary, config: { model_reasoning_summary: 'detailed' }, configOverrides: overrides, env: environment });
}

// A discovery-only stdio connection: no threads, turns, tools, or login writes.
export async function discoverCodexModels({ executable = codexExecutable, execute = exec, spawnImplementation = spawn, timeout = 15000 } = {}) {
  const { binary, overrides } = await decisionRuntime(executable, execute);
  const child = spawnImplementation(binary, [...overrides.flatMap(value => ['--config', value]), 'app-server'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  let failure;
  const rejectAll = error => {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.on('data', () => {}); // Drain, but do not expose login/config data.
  child.stdin.on('error', rejectAll);
  child.stdout.on('error', rejectAll);
  child.on('error', rejectAll);
  child.on('exit', () => rejectAll(new Error('Codex model discovery exited before completion')));
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { rejectAll(new Error('Invalid Codex discovery response')); return; }
    const request = pending.get(message.id);
    if (!request) {
      // Refuse unexpected server-initiated requests without executing anything.
      if (message.id !== undefined && message.method && !child.stdin.destroyed) child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Discovery client does not support actions' } }) + '\n');
      return;
    }
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? 'Codex discovery failed'));
    else request.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) rejectAll(error); });
  });
  const timer = setTimeout(() => rejectAll(new Error('Codex model discovery timed out')), timeout);
  try {
    await request('initialize', { clientInfo: { name: 'dia_model_picker', title: 'Dia+ Model Discovery', version: '1.0.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const models = new Map();
    const cursors = new Set();
    let cursor = null;
    do {
      const page = await request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.data)) throw new Error('Codex returned an invalid model catalog');
      for (const entry of page.data) {
        const id = entry.model ?? entry.id;
        if (typeof id !== 'string' || !id.trim()) throw new Error('Codex returned an invalid model ID');
        if (entry.hidden) continue;
        models.set(id, { id, label: entry.displayName || id, description: entry.description || '',
          isDefault: entry.isDefault === true, defaultReasoningEffort: entry.defaultReasoningEffort,
          supportedReasoningEfforts: entry.supportedReasoningEfforts ?? [], inputModalities: entry.inputModalities ?? ['text', 'image'] });
      }
      cursor = page.nextCursor;
      if (cursor && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 100)) throw new Error('Invalid Codex model pagination');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (!models.size) throw new Error('Codex returned no picker-visible models');
    return [...models.values()];
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.destroy();
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
    killTimer.unref();
  }
}
