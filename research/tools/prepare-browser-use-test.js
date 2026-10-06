#!/usr/bin/env node
// Builds a disposable research copy. This is not an installer or an audit approval.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const withBaseFlags = args.includes('--base-flags');
const selected = args.filter(arg => arg !== '--base-flags');
if (!selected.length) selected.push('browser-use-tasks');
const experimentIDs = ['browser-use-tasks', 'chat-controls', 'split-view-refinements', 'workspaces-spaces'];
if (selected.some(id => !experimentIDs.includes(id))) throw new Error('Unknown native feature experiment');
const installed = '/Applications/Dia+.app';
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
const build = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
if (build !== '87864') throw new Error('Research procedure is only scoped to Dia build 87864.');
const root = await mkdtemp(join(tmpdir(), 'dia-browser-use-research-'));
await mkdir(join(root, 'profile/Bridge/.state'), { recursive: true, mode: 0o700 });
const app = join(root, 'Dia+.Research.app');
execFileSync('/bin/cp', ['-cR', installed, app]);
const bridge = join(app, 'Contents/Resources/DiaCustomBridge');
execFileSync('/usr/bin/ditto', [join(repo, 'bridge/src'), join(bridge, 'src')]);
const manifest = JSON.parse(await readFile(join(repo, 'bridge/config/dia-mods.json'), 'utf8'));
for (const id of selected) {
  const experiment = manifest.mods.find(mod => mod.id === id);
  experiment.availability = 'research-only';
  experiment.availabilityReason = 'Disposable native investigation; not approved for installation.';
}
await writeFile(join(bridge, 'config/dia-mods.json'), JSON.stringify(manifest, null, 2));
const info = join(app, 'Contents/Info.plist');
const plist = command => execFileSync('/usr/libexec/PlistBuddy', ['-c', command, info]);
// Exclude the Settings sidebar injection during native feature investigation.
const mods = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :DiaCustomEnabledMods', info], { encoding: 'utf8' }).trim().split(',').filter(id => !['mod-manager', 'developer-tools', ...experimentIDs].includes(id)).concat(selected).join(',');
const configScript = await readFile(join(repo, 'scripts/configure-profile.sh'), 'utf8');
const flags = withBaseFlags
  ? [...new Set([...configScript.matchAll(/"([a-z0-9-]+=(?:true|false))"/g)].map(match => match[1]))]
  : [];
// Explicit false entries make the control condition reproducible even when
// this separate research preference domain contains an older test's overrides.
for (const id of experimentIDs) flags.push(...manifest.mods.find(mod => mod.id === id)
  .nativeFeatureFlags.map(flag => flag + '=' + selected.includes(id)));
const source = await readFile(join(repo, 'src/bootstrap/offline-bootstrap.c'), 'utf8');
const anchor = '    dia_custom_prepare_self_contained_runtime();';
if (source.split(anchor).length !== 2) throw new Error('Research bootstrap insertion point changed.');
const generatedSource = join(root, 'research-bootstrap.m');
await writeFile(generatedSource, '#include ' + JSON.stringify(join(repo, 'research/tools/native-feature-probe.m')) + '\n' + source.replace(anchor, '    dia_research_prepare();\n' + anchor));
const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
const object = join(root, 'research-bootstrap.o');
const dylib = join(root, 'research-bootstrap.dylib');
execFileSync('/usr/bin/xcrun', ['clang', '-target', 'arm64-apple-macos14.0', '-c', '-Os', '-fblocks', '-isysroot', sdk,
  '-I', join(repo, '.build/bootstrap'), '-I', join(repo, 'src/bootstrap'),
  '-DDIA_RESEARCH_APP=' + JSON.stringify(app), '-DDIA_RESEARCH_PROFILE=' + JSON.stringify(join(root, 'profile')),
  '-DDIA_RESEARCH_MODS=' + JSON.stringify(mods), '-DDIA_RESEARCH_FLAGS=' + JSON.stringify(flags.join(',')),
  generatedSource, '-o', object]);
execFileSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos14.0', '-emit-library', '-O', '-sdk', sdk,
  join(repo, 'src/bootstrap/offline-bootstrap-introspection.swift'), join(repo, 'research/tools/native-state-probe.swift'), object, join(repo, '.build/bootstrap/offline-bootstrap-arm64.o'),
  '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'WebKit', '-o', dylib]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', dylib]);
execFileSync(process.execPath, [join(repo, 'src/patches/embed-bootstrap.js'), app, dylib]);
// Separate preference domain: native tests cannot write the normal app's defaults.
plist('Set :CFBundleIdentifier local.rttm.dia.browser-use-research');
plist("Set :CFBundleDisplayName 'Dia+ Research'");
plist(`Set :DiaCustomEnabledMods '${mods}'`);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', join(repo, 'src/config/clone-entitlements.plist'), app]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const state = join(root, 'profile/Bridge/.state');
await writeFile(join(state, 'config.json'), JSON.stringify({
  version: 1, selectedModel: 'fixture:qa',
  providers: [{ id: 'fixture', type: 'openai-compatible', api: 'chat-completions', label: 'Local QA fixture', enabled: true,
    baseURL: 'http://127.0.0.1:18865/v1', apiKeyEnv: null, discoveryURL: null, models: [{ id: 'qa', label: 'Local QA fixture' }] }],
  localMemory: { enabled: false, importBrowserHistory: false, captureChats: false, deriveMemories: false, automaticRecall: false },
  localWeb: { enabled: false }, localConnectors: { enabled: false }, adminToken: randomBytes(24).toString('base64url'),
}), { mode: 0o600 });
await writeFile(join(state, 'mods.json'), JSON.stringify({ schemaVersion: 1, overrides: { 'developer-tools': false, 'mod-manager': false, ...Object.fromEntries(experimentIDs.map(id => [id, selected.includes(id)])) } }), { mode: 0o600 });
const baseline = {};
for (const name of ['config.json', 'credentials.json', 'mods.json']) {
  const bytes = await readFile(join('/Users/ryan/Library/Application Support/Dia Custom RTTM/Bridge/.state', name));
  baseline[name] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(join(root, 'normal-state-hashes.json'), JSON.stringify(baseline, null, 2), { mode: 0o600 });
await writeFile(join(root, 'test.json'), JSON.stringify({ root, app, profile: join(root, 'profile'), mods, build, fixturePort: 18865, bakedIsolation: true, experiments: selected, flags }, null, 2), { mode: 0o600 });
console.log(root);
