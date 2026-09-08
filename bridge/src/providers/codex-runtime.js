import { Codex } from '@openai/codex-sdk';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { bridgeDirectory } from '../paths.js';
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
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
  // Prefer the current signed app CLI when installed. npm SDK releases can lag
  // the desktop config schema. Installed Dia also carries a compatible copy.
  for (const candidate of [process.env.DIA_CUSTOM_CODEX_BINARY, '/Applications/Codex.app/Contents/Resources/codex', join(bridgeDirectory,'bin/codex')].filter(Boolean)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* next supported runtime */ }
  }
  if (process.platform !== 'darwin') throw new Error('The bundled Dia Codex adapter requires macOS');
  const packageName = process.arch === 'arm64' ? '@openai/codex-darwin-arm64' : '@openai/codex-darwin-x64';
  const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return join(dirname(require.resolve(`${packageName}/package.json`)), 'vendor', triple, 'bin/codex');
}
export async function createDecisionCodex({ executable = codexExecutable, execute = exec, CodexClient = Codex } = {}) {
  const binary = await executable();
  const base = decisionConfigOverrides([]);
  // An empty TOML table merges with user configuration; it does not remove its
  // MCP servers. Enumerate names without starting servers, then disable each.
  let inventory;
  try {
    const { stdout } = await execute(binary, [...base.flatMap(value => ['--config',value]), 'mcp','list','--json'], { env: environment, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    inventory = JSON.parse(stdout);
  } catch(error) {
    throw new Error('Codex could not load its login/configuration. Update the Codex app or rebuild Dia Custom with a compatible Codex CLI. ' + String(error.message).slice(0,800));
  }
  if (!Array.isArray(inventory)) throw new Error('Codex returned an invalid MCP inventory');
  return new CodexClient({ codexPathOverride: binary, config: { model_reasoning_summary: 'detailed' }, configOverrides: decisionConfigOverrides(inventory), env: environment });
}
