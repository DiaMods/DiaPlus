#!/usr/bin/env node
// Change the experimental group in a stopped, disposable app/profile.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireResearchCopy } from './research-copy-guard.js';
const [rootArg, ...options] = process.argv.slice(2);
const selected = options.filter(option => !option.startsWith('--flag='));
// Explicit dependency experiments only; never import the production flag list.
const dependencyFlags = options.filter(option => option.startsWith('--flag=')).map(option => option.slice(7));
const dependencies = ['spaces-new-top-bar-transition-enabled', 'clia-agents-chat-enabled',
  'force-classic-chat-enabled', 'clia-settings-toggle-always-visible-enabled', 'apps-pref-pane-redesign-enabled'];
if (dependencyFlags.some(flag => !/^[a-z0-9-]+=(true|false)$/.test(flag) || !dependencies.includes(flag.split('=')[0])))
  throw new Error('Unknown research dependency flag');
if (!rootArg) throw new Error('usage: configure-feature-test.js ROOT [MOD_ID...]');
const { root, test } = await requireResearchCopy(rootArg);
execFileSync(process.execPath, [new URL('../../scripts/browser-process-guard.js', import.meta.url).pathname, 'assert-stopped', test.app]);
const manifestPath = join(test.app, 'Contents/Resources/DiaCustomBridge/config/dia-mods.json');
const manifest = JSON.parse(await readFile(manifestPath));
const experiments = manifest.mods.filter(mod => mod.nativeFeatureFlags?.length);
const ids = experiments.map(mod => mod.id);
if (selected.some(id => !ids.includes(id))) throw new Error('Unknown native feature experiment');
for (const mod of experiments) mod.availability = selected.includes(mod.id) ? 'research-only' : 'pending-audit';
test.experiments = selected;
test.flags = experiments.flatMap(mod => mod.nativeFeatureFlags.map(flag => flag + '=' + selected.includes(mod.id)));
test.flags.push(...dependencyFlags);
test.mods = test.mods.split(',').filter(id => !ids.includes(id)).concat(selected).join(',');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const modsPath = join(test.profile, 'Bridge/.state/mods.json');
const state = JSON.parse(await readFile(modsPath));
for (const id of ids) state.overrides[id] = selected.includes(id);
await writeFile(modsPath, JSON.stringify(state), { mode: 0o600 });
await writeFile(join(root, 'test.json'), JSON.stringify(test, null, 2), { mode: 0o600 });
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :DiaCustomEnabledMods ' + test.mods, join(test.app, 'Contents/Info.plist')]);
execFileSync(process.execPath, [new URL('./rebuild-feature-bootstrap.js', import.meta.url).pathname, root], { stdio: 'inherit' });
console.log('Research selection: ' + (selected.join(', ') || 'all experimental groups disabled'));
