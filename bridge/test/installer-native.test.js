import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { run, saveJSON } from '../src/updater-common.js';
import { installerIsRunning, installerService } from '../src/installer-handoff.js';

// Real LaunchServices app lifetime, not a shell-parent or mocked launchctl.
// No installed browser, profile, Keychain credentials or update is accessed.
test('downloaded worker quits its native app parent and survives Dock cleanup with disclaimed responsibility', {
  skip: process.platform !== 'darwin', timeout: 90000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dia-installer-native-'));
  const job = join(root, 'job'), toolkit = join(job, 'toolkit');
  const app = join(root, 'Installer Parent Fixture.app');
  const done = join(root, 'completed'), parentPID = join(root, 'parent-pid');
  const identifier = `local.rttm.dia.installer-fixture.${process.pid}`;
  await mkdir(join(app, 'Contents/MacOS'), { recursive: true });
  await mkdir(join(toolkit, 'bridge/src'), { recursive: true });
  const service = installerService(job);
  t.after(async () => {
    await run('/bin/launchctl', ['bootout', service.target]).catch(() => {});
    await run(join(job, 'quit-app'), [app], { timeout: 50000 }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const source = join(root, 'parent.m');
  await writeFile(source, `#import <AppKit/AppKit.h>
int main(int argc, const char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  NSString *pid = [NSString stringWithFormat:@"%d", getpid()];
  [pid writeToFile:[NSString stringWithUTF8String:argv[4]] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSTask *child = [[NSTask alloc] init];
  child.executableURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
  child.arguments = @[[NSString stringWithUTF8String:argv[2]], [NSString stringWithUTF8String:argv[3]]];
  if (![child launchAndReturnError:nil]) return 2;
  [NSApp run];
} return 0; }
`);
  await run('/usr/bin/xcrun', ['clang', '-x', 'objective-c', '-fblocks', source, '-framework', 'AppKit', '-o', join(app, 'Contents/MacOS/Parent')]);
  await writeFile(join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>Parent</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  const quitSource = join(root, 'quit.swift'), quit = join(job, 'quit-app');
  // The real quit logic, restricted to this disposable app's unique identity.
  await writeFile(quitSource, (await readFile(new URL('../../src/updater/quit-app.swift', import.meta.url), 'utf8')).replace('"local.rttm.dia"', JSON.stringify(identifier)));
  await run('/usr/bin/xcrun', ['swiftc', quitSource, '-o', quit]);
  await mkdir(join(toolkit, 'prebuilt'), { recursive: true });
  await mkdir(join(toolkit, 'scripts'), { recursive: true });
  await writeFile(join(toolkit, 'package.json'), '{"type":"module"}');
  await writeFile(join(toolkit, 'scripts/prebuilt.js'), await readFile(new URL('../../scripts/prebuilt.js', import.meta.url)));
  const bootstrap = join(toolkit, 'prebuilt/installer-bootstrap');
  await run('/usr/bin/xcrun', ['clang', '-O2', fileURLToPath(new URL('../../src/updater/installer-bootstrap.c', import.meta.url)), '-o', bootstrap]);
  const digest = createHash('sha256').update(await readFile(bootstrap)).digest('hex');
  await saveJSON(join(toolkit, 'prebuilt/manifest.json'), { schemaVersion: 1, helpers: [{ name: 'installer-bootstrap', file: 'installer-bootstrap', inputHash: null, sha256: digest }] });
  const transaction = { job, toolkit, app, node: process.execPath, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } };
  await saveJSON(join(job, 'transaction.json'), transaction);
  // Invoke the REAL old-client entry point, then the real independence check
  // and quit helper. Remain alive beyond the observed ~40-second Dock cleanup
  // window. No installation, profile or cloud credentials are accessed.
  const handoff = new URL('../src/installer-handoff.js', import.meta.url).href;
  const common = new URL('../src/updater-common.js', import.meta.url).href;
  await writeFile(join(toolkit, 'bridge/src/update-worker.js'), `
(async()=>{const fs=await import('node:fs'); const {assertIndependentInstaller}=await import(${JSON.stringify(handoff)});
const {run}=await import(${JSON.stringify(common)}); const t=JSON.parse(fs.readFileSync(process.argv[2]));
if(!process.argv.includes('--launchd-worker')) throw Error('Missing independent mode');
await assertIndependentInstaller(t); await run(${JSON.stringify(quit)},[t.app],{timeout:50000});
fs.writeFileSync(${JSON.stringify(join(root, 'quit-completed'))},'quit');
await new Promise(resolve=>setTimeout(resolve,45000)); fs.writeFileSync(${JSON.stringify(done)},'survived');
})().catch(e=>{console.error(e);process.exitCode=1});`);
  const worker = fileURLToPath(new URL('../src/update-worker.js', import.meta.url));
  await run('/usr/bin/open', ['-n', '-a', app, '--args', process.execPath, worker, join(job, 'transaction.json'), parentPID]);
  let pid;
  for (let n = 0; n < 100; n++) {
    pid = await readFile(parentPID, 'utf8').then(Number).catch(() => null);
    if (pid) break;
    await delay(50);
  }
  assert(Number.isInteger(pid) && pid > 1, 'native fixture must launch');
  let quitCompleted = false;
  for (let n = 0; n < 200; n++) {
    quitCompleted = await readFile(join(root, 'quit-completed'), 'utf8').then(text => text === 'quit').catch(() => false);
    if (quitCompleted) break;
    await delay(50);
  }
  assert(quitCompleted, 'real quit helper must observe the original browser PID exiting promptly; fixture log: ' + await readFile(join(job, 'install.log'), 'utf8').catch(() => '(missing)'));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'native parent must have actually quit');
  let completed = false;
  for (let n = 0; n < 1000; n++) {
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
