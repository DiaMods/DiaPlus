#!/usr/bin/env node
// Rebuild a stopped, baked-isolation research copy. Never targets installed apps.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireResearchCopy } from './research-copy-guard.js';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { root, test } = await requireResearchCopy(process.argv[2]);
execFileSync(process.execPath, [join(repo, 'scripts/browser-process-guard.js'), 'assert-stopped', test.app]);
const source = await readFile(join(repo, 'src/bootstrap/offline-bootstrap.c'), 'utf8');
const anchor = '    dia_custom_prepare_self_contained_runtime();';
if (source.split(anchor).length !== 2) throw new Error('Bootstrap insertion point changed');
const generated = join(root, 'research-bootstrap.m');
await writeFile(generated, '#include ' + JSON.stringify(join(repo, 'research/tools/native-feature-probe.m')) + '\n' + source.replace(anchor, '    dia_research_prepare();\n' + anchor));
const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {encoding:'utf8'}).trim();
execFileSync('/usr/bin/xcrun', ['clang', '-target', 'arm64-apple-macos14.0', '-c', '-Os', '-fblocks', '-isysroot', sdk,
  '-I', join(repo, '.build/bootstrap'), '-I', join(repo, 'src/bootstrap'),
  '-DDIA_RESEARCH_APP=' + JSON.stringify(test.app), '-DDIA_RESEARCH_PROFILE=' + JSON.stringify(test.profile),
  '-DDIA_RESEARCH_MODS=' + JSON.stringify(test.mods), '-DDIA_RESEARCH_FLAGS=' + JSON.stringify(test.flags.join(',')),
  generated, '-o', join(root,'research-bootstrap.o')]);
const dylib = join(test.app, 'Contents/Frameworks/DiaCustomBootstrap.dylib');
execFileSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos14.0', '-emit-library', '-O', '-sdk', sdk,
  join(repo, 'src/bootstrap/offline-bootstrap-introspection.swift'), join(repo, 'research/tools/native-state-probe.swift'), join(root, 'research-bootstrap.o'), join(repo, '.build/bootstrap/offline-bootstrap-arm64.o'),
  '-framework','Foundation','-framework','AppKit','-framework','WebKit','-o',dylib]);
execFileSync('/usr/bin/codesign', ['--force','--sign','-',dylib]);
execFileSync('/usr/bin/codesign', ['--force','--sign','-','--entitlements',join(repo,'src/config/clone-entitlements.plist'),test.app]);
execFileSync('/usr/bin/codesign', ['--verify','--deep','--strict',test.app]);
console.log('Research bootstrap rebuilt and verified.');
