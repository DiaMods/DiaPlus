#!/usr/bin/env node
// Static evidence only. Never enables flags, launches Dia or claims runtime QA.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyOfficial } from '../../scripts/download-official.js';

const app = process.argv[2];
if (!app || process.argv.length !== 3) throw new Error('usage: audit-browser-use-tasks.js /path/to/official/Dia.app');
const release = JSON.parse(await readFile(new URL('../../src/config/release-build.json', import.meta.url))).dia;
const source = JSON.parse(await readFile(new URL('../../src/config/updater-source.json', import.meta.url)));
await verifyOfficial(resolve(app), release, source);
const binary = await readFile(join(resolve(app), 'Contents/MacOS/Dia'));
const schemaBytes = await readFile(join(resolve(app), 'Contents/Resources/agent-server-resources/dist/resources/tool-schemas/dia.json'));
const schema = JSON.parse(schemaBytes);
const legacyHomeManifest = JSON.parse(await readFile(join(resolve(app), 'Contents/Resources/home-surface-resources/dist/manifest.json')));
if (binary.length < 32 || binary.readUInt32LE(0) !== 0xfeedfacf || binary.readUInt32LE(4) !== 0x100000c) throw new Error('Expected a thin arm64 Dia executable');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const occurrences = value => {
  const needle = Buffer.from(value + '\0'), hits = [];
  for (let offset = binary.indexOf(needle); offset !== -1; offset = binary.indexOf(needle, offset + 1)) {
    if (offset === 0 || binary[offset - 1] === 0) hits.push('0x' + offset.toString(16));
  }
  return hits;
};
const flags = ['task-browser-use-enabled', 'tasks-style-enabled', 'task-execution-default-chat-enabled'];
const surfaces = ['TasksSidebar', 'TasksTopBar', 'TaskListPresentation', 'TaskSurfaceAccessController', 'TaskExecutionUtilities'];
const tool = schema.tools?.find(tool => tool.name === 'browser_use');
const requiredCapabilities = tool?._meta?.['dia/requiredCapabilities'] ?? [];
const sandboxContractPresent = tool?.annotations?.readOnlyHint === false &&
  requiredCapabilities.includes('tabs') && requiredCapabilities.includes('browserUse') &&
  tool?.inputSchema?.additionalProperties === false &&
  JSON.stringify(tool.inputSchema.required) === JSON.stringify(['code']) &&
  tool.inputSchema.properties?.code?.type === 'string' &&
  /sandboxed REPL/.test(tool.description ?? '') &&
  /imports, filesystem, network, or process APIs/.test(tool.inputSchema.properties.code.description ?? '');
const flagEvidence = flags.map(flag => ({ flag, stringOffsets: occurrences(flag) }));
const surfaceEvidence = surfaces.map(surface => ({ surface, stringOffsets: occurrences(surface) }));
console.log(JSON.stringify({
  mod: 'browser-use-tasks',
  publisherVerified: true,
  build: execFileSync('/usr/libexec/PlistBuddy', ['-c','Print :CFBundleVersion',join(resolve(app),'Contents/Info.plist')], {encoding:'utf8'}).trim(),
  executableSHA256: digest(binary), schemaSHA256: digest(schemaBytes),
  flags: flagEvidence, surfaces: surfaceEvidence,
  browserUse: { schemaPresent: Boolean(tool), sandboxContractPresent, requiredCapabilities },
  legacyHomeExtension: {
    hasEntryPoint: Boolean(legacyHomeManifest.background || legacyHomeManifest.content_scripts ||
      legacyHomeManifest.chrome_url_overrides || legacyHomeManifest.action || legacyHomeManifest.web_accessible_resources),
    description: legacyHomeManifest.description,
  },
  structuralEvidencePresent: flagEvidence.every(flag => flag.stringOffsets.length === 1) && surfaceEvidence.every(surface => surface.stringOffsets.length > 0) && sandboxContractPresent,
  runtimeVerified: false, activationApproved: false,
  remaining: [
    'Inspect each gate and task-surface dependency; string presence is not a compatibility audit.',
    'The legacy Home extension is a compatibility stub, not evidence of a usable task dashboard.',
    'Test native UI in a disposable profile without Dia service access or personal data.',
    'Verify local-provider tool discovery, native sandbox execution and cancellation.',
    'Verify confirmations, isolated read/write fixtures, disable/restart behavior and rollback.',
  ],
}, null, 2));
