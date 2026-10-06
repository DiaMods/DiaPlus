import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('native picker detects both response layouts with typed Swift reads', {
  skip: process.platform !== 'darwin',
}, async t => {
  const source = await readFile(new URL('../../src/bootstrap/offline-bootstrap-introspection.swift', import.meta.url), 'utf8');
  const extract = (start, stop) => {
    const begin = source.indexOf(start);
    const end = source.indexOf(stop, begin);
    assert(begin >= 0 && end > begin);
    return source.slice(begin, end);
  };
  const helpers = extract('private func directReflectedValue(', '@_silgen_name("dia_custom_call_swift_void_method")') +
    extract('private func unwrappedValue(', 'private func nativeWindowControllers(');
  const root = await mkdtemp(join(tmpdir(), 'dia-picker-visibility-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Actual production readers; no browser profile, window, or event loop.
  await writeFile(join(root, 'test.swift'), `
import Foundation
import AppKit
${helpers}
final class Toolbar {
  var configuredUsesResponseCommandGroup = false
  let stopButton = NSView()
  var activePrimaryCTA: NSView?
}
final class ChangedToolbar {
  let configuredUsesResponseCommandGroup = 1
  let stopButton = "not a view"
  let activePrimaryCTA = "not a view"
}
func check(_ toolbar: AnyObject, _ expected: Bool) {
  precondition(toolbarUsesResponseCommands(Unmanaged.passUnretained(toolbar).toOpaque()) == expected)
}
let toolbar = Toolbar()
check(toolbar, false)
toolbar.configuredUsesResponseCommandGroup = true
check(toolbar, true)
toolbar.configuredUsesResponseCommandGroup = false
check(toolbar, false)
toolbar.activePrimaryCTA = toolbar.stopButton
check(toolbar, true)
toolbar.activePrimaryCTA = NSView()
check(toolbar, false)
toolbar.activePrimaryCTA = nil
check(toolbar, false)
check(ChangedToolbar(), false)
check(NSObject(), false)
precondition(!toolbarUsesResponseCommands(nil))
`);
  execFileSync('/usr/bin/xcrun', ['swiftc', join(root, 'test.swift'), '-o', join(root, 'test')], { stdio: 'pipe' });
  execFileSync(join(root, 'test'), [], { stdio: 'pipe' });
  const bootstrap = await readFile(new URL('../../src/bootstrap/offline-bootstrap.c', import.meta.url), 'utf8');
  assert.match(bootstrap, /BOOL responseCommands = dia_custom_swift_toolbar_uses_response_commands/);
  assert.match(bootstrap, /\[popup setHidden:responseCommands\]/);
  assert.match(bootstrap, /\[popup setAlphaValue:responseCommands \? 0\.0 : 1\.0\]/);
});
