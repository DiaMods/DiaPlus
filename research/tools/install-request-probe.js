#!/usr/bin/env node
// Sanitized request metadata in stopped disposable copies only. No messages,
// system prompts, browser context, headers, credentials or request bodies.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireResearchCopy } from './research-copy-guard.js';
const { root, test } = await requireResearchCopy(process.argv[2]);
execFileSync(process.execPath, [new URL('../../scripts/browser-process-guard.js', import.meta.url).pathname, 'assert-stopped', test.app]);
const path = join(test.app, 'Contents/Resources/DiaCustomBridge/src/server.js');
let source = await readFile(path, 'utf8');
if (source.includes('function researchControlShape(')) throw new Error('Probe is already installed');
const probe = `
function researchControlShape(payload) {
  const shape = { keys: Object.keys(payload), controls: {} };
  function inspect(value, path = '', depth = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return;
    for (const [key, item] of Object.entries(value)) {
      if (/messages|system|context|content|prompt|credential|token|key|auth/i.test(key)) continue;
      const name = path ? path + '.' + key : key;
      if (/model|reasoning|thinking|effort|personalization|feature|sub_feature|stream|fast|mode/i.test(key)) {
        if (typeof item === 'boolean' || typeof item === 'number') shape.controls[name] = item;
        else if (typeof item === 'string') shape.controls[name] = /^[a-zA-Z0-9_:./-]{1,100}$/.test(item) ? item : '[redacted]';
        else if (item && typeof item === 'object' && !Array.isArray(item)) shape.controls[name + '.keys'] = Object.keys(item);
      }
      inspect(item, name, depth + 1);
    }
  }
  inspect(payload);
  process.stdout.write('research-native-control=' + JSON.stringify(shape) + '\\n');
}
`;
const anchors = [
  '  const payload = JSON.parse(plaintext.toString("utf8"));',
  '  const toolCount = Array.isArray(payload.tools) ? payload.tools.length : 0;',
];
for (const anchor of anchors) {
  if (source.split(anchor).length !== 2) throw new Error('Research insertion point changed');
  source = source.replace(anchor, anchor + '\n  researchControlShape(payload);');
}
source = probe + source;
await writeFile(path, source);
execFileSync(process.execPath, ['--check', path]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', new URL('../../src/config/clone-entitlements.plist', import.meta.url).pathname, test.app]);
console.log('Sanitized control metadata probe installed in the research copy.');
