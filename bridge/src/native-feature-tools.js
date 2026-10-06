import { modEnabled } from './mods.js';

const browserUseTaskTools = new Set(['browser_use', 'update_task_user_preferences']);

export function isBrowserUseTaskTool(name) {
  if (typeof name !== 'string') return false;
  const canonical = name.startsWith('mcp__dia-tools__') ? name.slice('mcp__dia-tools__'.length) : name;
  return browserUseTaskTools.has(canonical);
}

export function nativeFeatureToolAllowed(name) {
  return !isBrowserUseTaskTool(name) || modEnabled('browser-use-tasks');
}
