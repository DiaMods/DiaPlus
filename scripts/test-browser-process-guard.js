#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProcessProbe, matchingBrowserProcesses, profileArgument, stopProfileBrowser } from './browser-process-guard.js';

if (process.platform !== 'darwin') {
  process.stdout.write('skip  exact browser-process fixtures require macOS\n');
  process.exit(0);
}

const scripts = dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'dia-custom-process-tests-'));
const app = join(directory, 'Dia Custom [Fixture] (1)+.app');
const executable = join(app, 'Contents/MacOS/Dia');
const decoyExecutable = `${executable}.decoy`;
const profile = join(directory, 'Profile [a-z]+ (1)');
const userData = join(profile, 'User Data');
const children = [];
let probe;
let preflightPID;

async function startFixture(path, args) {
  const child = spawn(path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  await Promise.race([
    once(child.stdout, 'data'),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('fixture did not start')), 3000); timer.unref(); }),
  ]);
  return child;
}

async function stopFixture(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

function running(child) {
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  process.kill(child.pid, 0);
}

try {
  await mkdir(dirname(executable), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, 'Local State'), '{}');
  const fixtureSource = join(directory, 'fixture.c');
  // A real, uniquely named executable makes proc_pidpath testing meaningful.
  // Only this test's children are signaled. The preflight variant serves the
  // readiness endpoint and deliberately ignores TERM so cleanup must preserve.
  await writeFile(fixtureSource, `
    #include <arpa/inet.h>
    #include <signal.h>
    #include <stdio.h>
    #include <stdlib.h>
    #include <string.h>
    #include <sys/socket.h>
    #include <unistd.h>
    static volatile sig_atomic_t slow_stop;
    static void request_slow_stop(int signal) { (void)signal; slow_stop = 1; }
    int main(int argc, char **argv) {
      int port = 0;
      for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--ignore-term")) signal(SIGTERM, SIG_IGN);
        if (!strcmp(argv[i], "--slow-term")) signal(SIGTERM, request_slow_stop);
        if (!strncmp(argv[i], "--exit-after=", 13)) alarm((unsigned)atoi(argv[i] + 13));
        if (!strncmp(argv[i], "--remote-debugging-port=", 24)) port = atoi(argv[i] + 24);
      }
      if (getenv("DIA_CUSTOM_PREFLIGHT")) {
        if (strcmp(getenv("DIA_TEST_PREFLIGHT_IGNORE_TERM"), "0")) signal(SIGTERM, SIG_IGN);
        FILE *file = fopen(getenv("DIA_TEST_PREFLIGHT_PID_FILE"), "w");
        if (!file) return 2;
        fprintf(file, "%d", getpid()); fclose(file);
      }
      int server = -1;
      if (port) {
        server = socket(AF_INET, SOCK_STREAM, 0);
        struct sockaddr_in address = { .sin_family = AF_INET, .sin_port = htons(port) };
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (bind(server, (struct sockaddr *)&address, sizeof(address)) || listen(server, 4)) return 3;
      }
      puts("ready"); fflush(stdout);
      while (1) {
        if (slow_stop) { sleep(6); return 0; }
        if (server < 0) { pause(); continue; }
        int client = accept(server, NULL, NULL);
        if (client < 0) continue;
        char request[4096]; read(client, request, sizeof(request));
        const char *reply = "HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\n[]";
        write(client, reply, strlen(reply)); close(client);
        if (getenv("DIA_TEST_PREFLIGHT_EXIT_AFTER_READY")) return 0;
      }
    }
  `);
  execFileSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', fixtureSource, '-o', executable]);
  await cp(executable, decoyExecutable);
  probe = createProcessProbe();

  assert.equal(profileArgument(['Dia', '--user-data-dir=first', '--user-data-dir', 'last']), 'last');
  assert.equal(profileArgument(['Dia', `prefix --user-data-dir=${userData}`]), undefined);
  assert.equal(profileArgument(['Dia', '--', `--user-data-dir=${userData}`]), undefined);
  const parent = await startFixture(executable, [`--user-data-dir=${userData}`]);
  const suffix = await startFixture(executable, [`--user-data-dir=${userData}.suffix`]);
  const commandText = await startFixture(decoyExecutable, [`${executable} --user-data-dir=${userData}`]);
  const literal = await startFixture(decoyExecutable, [`--user-data-dir=${userData}.suffix`]);
  const listed = matchingBrowserProcesses(probe.list(), app, profile);
  assert.ok(listed.some(({ pid }) => pid === parent.pid));
  assert.ok(listed.some(({ pid }) => pid === suffix.pid), 'same app with another profile still blocks app replacement');
  assert.ok(!listed.some(({ pid }) => pid === commandText.pid || pid === literal.pid));
  const record = listed.find(({ pid }) => pid === parent.pid);
  probe.terminate({ ...record, startSeconds: String(BigInt(record.startSeconds) + 1n) }, userData);
  running(parent);
  const exited = once(parent, 'exit');
  await stopProfileBrowser(probe, app, profile);
  await exited;
  assert.equal(parent.signalCode, 'SIGTERM');
  for (const decoy of [suffix, commandText, literal]) running(decoy);
  await stopFixture(suffix);

  const foreign = await startFixture(decoyExecutable, ['--user-data-dir', userData]);
  await assert.rejects(stopProfileBrowser(probe, app, profile, { timeoutMs: 150, intervalMs: 25 }), /still in use/);
  running(foreign);
  await stopFixture(foreign);

  // A populated native profile can flush slowly after TERM while unsignaled
  // helper processes also release that exact profile. The old five-second
  // production default failed this case; wait without killing the helper.
  const delayed = await startFixture(executable, ['--slow-term', '--user-data-dir', userData]);
  const releasingHelper = await startFixture(decoyExecutable, ['--exit-after=7', '--user-data-dir', userData]);
  const delayedExit = once(delayed, 'exit'), helperExit = once(releasingHelper, 'exit');
  const shutdownStarted = Date.now();
  await stopProfileBrowser(probe, app, profile);
  await Promise.all([delayedExit, helperExit]);
  assert.ok(Date.now() - shutdownStarted >= 6000, 'must wait beyond the old five-second cutoff');
  assert.equal(delayed.exitCode, 0, 'the browser completed its own delayed shutdown');
  assert.equal(releasingHelper.signalCode, 'SIGALRM', 'the guard must not signal a foreign helper');
  assert.ok(!matchingBrowserProcesses(probe.list(), app, profile).some(p => p.pid === delayed.pid || p.pid === releasingHelper.pid));
  for (const decoy of [commandText, literal]) running(decoy);
  process.stdout.write('ok    delayed browser/helper profile release waits beyond five seconds without force or foreign signals\n');

  const stubborn = await startFixture(executable, ['--ignore-term', '--user-data-dir', userData]);
  await assert.rejects(stopProfileBrowser(probe, app, profile, { timeoutMs: 150, intervalMs: 25 }), /preserving/);
  running(stubborn);
  const backupRoot = join(directory, 'backups');
  let snapshot = spawnSync('/bin/zsh', [join(scripts, 'snapshot-profile.sh'), profile, backupRoot, 'blocked'], {
    encoding: 'utf8', env: { ...process.env, DIA_CUSTOM_APP: app },
  });
  assert.notEqual(snapshot.status, 0, snapshot.stderr);
  await assert.rejects(stat(backupRoot), { code: 'ENOENT' });
  await stopFixture(stubborn);
  snapshot = spawnSync('/bin/zsh', [join(scripts, 'snapshot-profile.sh'), profile, backupRoot, 'decoys'], {
    encoding: 'utf8', env: { ...process.env, DIA_CUSTOM_APP: app },
  });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  assert.equal(await readFile(join(snapshot.stdout.trim(), 'User Data/Local State'), 'utf8'), '{}');
  for (const decoy of [commandText, literal]) running(decoy);
  await assert.rejects(stopProfileBrowser({ list() { throw new Error('inspection unavailable'); } }, app, profile), /inspection unavailable/);
  process.stdout.write('ok    native browser guard respects exact executable/argv boundaries and PID identity; decoys survive\n');
  process.stdout.write('ok    snapshot rejects live profiles; unavailable inspection and stubborn processes fail closed\n');

  const pidFile = join(directory, 'preflight.pid');
  const preflight = spawnSync('/bin/zsh', [join(scripts, 'preflight-profile.sh'), app, profile], {
    encoding: 'utf8', timeout: 75000, env: { ...process.env, DIA_CUSTOM_WORK_DIR: directory,
      DIA_CUSTOM_PREFLIGHT_SETTLE_SECONDS: '0', DIA_TEST_PREFLIGHT_PID_FILE: pidFile, DIA_TEST_PREFLIGHT_IGNORE_TERM: '1' },
  });
  preflightPID = Number(await readFile(pidFile, 'utf8'));
  assert.notEqual(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stderr, /temporary profile preserved/);
  const roots = (await readdir(directory)).filter((entry) => entry.startsWith('Dia Custom RTTM.profile-preflight.'));
  assert.equal(roots.length, 1);
  const preserved = join(directory, roots[0], 'profile');
  assert.equal(await readFile(join(preserved, 'User Data/Local State'), 'utf8'), '{}');
  process.kill(preflightPID, 0);
  process.stdout.write('ok    preflight refuses success and preserves its temporary profile when TERM is ignored\n');
  process.kill(preflightPID, 'SIGKILL');
  preflightPID = undefined;
  const successful = spawnSync('/bin/zsh', [join(scripts, 'preflight-profile.sh'), app, profile], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, DIA_CUSTOM_WORK_DIR: directory,
      DIA_CUSTOM_PREFLIGHT_SETTLE_SECONDS: '0', DIA_TEST_PREFLIGHT_PID_FILE: pidFile, DIA_TEST_PREFLIGHT_IGNORE_TERM: '0' },
  });
  assert.equal(successful.status, 0, successful.stderr);
  assert.match(successful.stdout, /profile preflight retained/);
  assert.deepEqual((await readdir(directory)).filter((entry) => entry.startsWith('Dia Custom RTTM.profile-preflight.')), roots);
  process.stdout.write('ok    both successful preflight launches shut down and remove only their own temporary profile\n');
  const lateExit = spawnSync('/bin/zsh', [join(scripts, 'preflight-profile.sh'), app, profile], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, DIA_CUSTOM_WORK_DIR: directory,
      DIA_CUSTOM_PREFLIGHT_SETTLE_SECONDS: '1', DIA_TEST_PREFLIGHT_PID_FILE: pidFile,
      DIA_TEST_PREFLIGHT_IGNORE_TERM: '0', DIA_TEST_PREFLIGHT_EXIT_AFTER_READY: '1' },
  });
  assert.notEqual(lateExit.status, 0);
  assert.match(lateExit.stderr, /exited during native startup/);
  assert.deepEqual((await readdir(directory)).filter(entry => entry.startsWith('Dia Custom RTTM.profile-preflight.')), roots);
  process.stdout.write('ok    native preflight rejects a browser that exits after initial readiness\n');
} finally {
  // This PID is written only by the fixture binary launched for this test.
  if (preflightPID) { try { process.kill(preflightPID, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  for (const child of children) await stopFixture(child);
  probe?.dispose();
  await rm(directory, { recursive: true, force: true });
}
