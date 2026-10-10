import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { run, saveJSON } from '../src/updater-common.js';
import { installerIsRunning, installerService } from '../src/installer-handoff.js';

// Real LaunchServices app lifetime, not a shell-parent or mocked launchctl.
// No installed browser, profile, Keychain credentials or update is accessed.
test('downloaded worker survives its native app parent quitting through independent macOS handoff', {
  skip: process.platform !== 'darwin', timeout: 30000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-installer-native-'));
  const job = join(root, 'job'), toolkit = join(job, 'toolkit');
  const app = join(root, 'Installer Parent Fixture.app');
  const done = join(root, 'completed'), parentPID = join(root, 'parent-pid');
  await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
  await mkdir(join(toolkit, 'bridge/src'), { recursive: true });
  const service = installerService(job);
  t.after(async () => {
    await run('/bin/launchctl', ['bootout', service.target]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const source = join(root, 'parent.m');
  await writeFile(source, `#import <AppKit/AppKit.h>
int main(int argc, const char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  NSString *pid = [NSString stringWithFormat:@"%d", getpid()];
  [pid writeToFile:[NSString stringWithUTF8String:argv[4]] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSTask *child = [[NSTask alloc] init];
  child.executableURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
  child.arguments = @[[NSString stringWithUTF8String:argv[2]], [NSString stringWithUTF8String:argv[3]]];
  if (![child launchAndReturnError:nil]) return 2;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
  [NSApp run];
} return 0; }
`);
  await run('/usr/bin/xcrun', ['clang', '-x', 'objective-c', '-fblocks', source, '-framework', 'AppKit', '-o', join(app, 'Contents/MacOS/Parent')]);
  await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.rttm.dia.installer-fixture.${process.pid}</string><key>CFBundleExecutable</key><string>Parent</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  const transaction = { job, toolkit, node: process.execPath, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } };
  await saveJSON(join(job, 'transaction.json'), transaction);
  // The independent worker is intentionally benign: only write a fixture
  // marker after the native parent has gone away. Invoke the REAL old-client
  // compatible entry point for its handoff, not the install transaction.
  await writeFile(join(toolkit, 'bridge/src/update-worker.js'), `const fs=require('node:fs'); if(!process.argv.includes('--launchd-worker')) throw Error('Missing independent mode'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(done)},'survived'), 4500);`);
  const worker = fileURLToPath(new URL('../src/update-worker.js', import.meta.url));
  await run('/usr/bin/open', ['-n', '-a', app, '--args', process.execPath, worker, join(job, 'transaction.json'), parentPID]);
  let pid;
  for (let n = 0; n < 100; n++) {
    pid = await readFile(parentPID, 'utf8').then(Number).catch(() => null);
    if (pid) break;
    await delay(50);
  }
  assert(Number.isInteger(pid) && pid > 1, 'native fixture must launch');
  let completed = false;
  for (let n = 0; n < 200; n++) {
    completed = await readFile(done, 'utf8').then(text => text === 'survived').catch(() => false);
    if (completed) break;
    await delay(50);
  }
  assert(completed, 'independent worker must finish after parent quits');
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'native parent must have actually quit');
  // Wait for the one-shot worker to exit before reading launchd's last result.
  for (let n = 0; n < 40 && await installerIsRunning(transaction); n++) await delay(50);
  assert.equal(await installerIsRunning(transaction), false);
  const info = await run('/bin/launchctl', ['print', service.target]);
  assert.match(info, /last exit code = 0/);
});
