#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPatchableCustomApp } from '../src/patches/custom-app-guard.js';

const scripts = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'dia-custom-install-transaction-'));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
try {
  for (const mode of ['staging-failure', 'swap-failure', 'state-failure', 'preferences-failure', 'success', 'first-install-failure', 'running-staged']) {
    const dir = join(root, mode), app = join(dir, 'Dia Custom Fixture [1].app');
    const staged = join(dir, 'Dia Custom RTTM.refresh.123.app'), backup = join(dir, '.backups', 'Dia Custom Fixture.app');
    const failed = join(dir, '.backups', 'Dia Custom Failed.app'), profile = join(dir, 'profile');
    const state = join(profile, 'Bridge/.state'), preferences = join(dir, 'preferences');
    await mkdir(state, { recursive: true });
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, 'identity'), 'new');
    if (mode !== 'first-install-failure') {
      await mkdir(app); await writeFile(join(app, 'identity'), 'old');
      await writeFile(join(state, 'compatibility.json'), 'old compatibility');
      await writeFile(join(state, 'latest-install-transaction.json'), 'old transaction');
      await writeFile(preferences, 'old preferences');
    }
    const harness = `set -euo pipefail
source ${quote(join(scripts, 'install-transaction.sh'))}
transaction_defaults() {
  case "$1" in
    export) /bin/cat ${quote(preferences)} ;;
    import) /bin/cp "$3" ${quote(preferences)} ;;
    delete) /bin/rm -f ${quote(preferences)} ;;
  esac
}
transaction_staged_stopped() { ${mode === 'running-staged' ? 'return 1' : 'return 0'}; }
transaction_begin ${[app, staged, backup, failed, profile].map(quote).join(' ')}
trap transaction_cleanup EXIT
${['staging-failure', 'running-staged'].includes(mode) ? 'exit 17' : ''}
transaction_capture_state || exit $?
${mode === 'swap-failure' ? `/bin/rm -rf ${quote(staged)}` : ''}
transaction_swap || exit $?
tx_state_started=true
print -n 'new compatibility' > ${quote(join(state, 'compatibility.json'))}
${mode === 'state-failure' ? 'exit 19' : ''}
print -n 'new transaction' > ${quote(join(state, 'latest-install-transaction.json'))}
print -n 'new preferences' > ${quote(preferences)}
${['preferences-failure', 'first-install-failure'].includes(mode) ? 'exit 23' : ''}
tx_finished=true
`;
    const execution = spawnSync('/bin/zsh', ['-c', harness], { encoding: 'utf8', env: { ...process.env, DIA_CUSTOM_STAGING: '0' } });
    assert.equal(execution.status === 0, mode === 'success', `${mode}: ${execution.stderr}`);
    const value = path => readFile(path, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    assert.equal(await value(join(app, 'identity')), mode === 'success' ? 'new' : mode === 'first-install-failure' ? null : 'old', mode);
    assert.equal(await value(join(state, 'compatibility.json')), mode === 'success' ? 'new compatibility' : mode === 'first-install-failure' ? null : 'old compatibility', mode);
    assert.equal(await value(join(state, 'latest-install-transaction.json')), mode === 'success' ? 'new transaction' : mode === 'first-install-failure' ? null : 'old transaction', mode);
    assert.equal(await value(preferences), mode === 'success' ? 'new preferences' : mode === 'first-install-failure' ? null : 'old preferences', mode);
    assert.equal(await value(join(staged, 'identity')), mode === 'running-staged' ? 'new' : null, mode);
  }
  const guardApp = join(root, 'Dia Custom RTTM.refresh.guard.app');
  await mkdir(join(guardApp, 'Contents'), { recursive: true });
  await writeFile(join(guardApp, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.rttm.dia</string></dict></plist>');
  assert.equal(assertPatchableCustomApp(guardApp), guardApp);
  // Run the actual entry points with fixture patch/sign/launch commands. These
  // catch staging-name and transaction-boundary errors without touching an app
  // outside this temporary directory or the user's preference domain.
  const fixture = join(root, 'toolkit'), fixtureScripts = join(fixture, 'scripts');
  await mkdir(fixtureScripts, { recursive: true });
  await mkdir(join(fixture, 'src/patches'), { recursive: true });
  for (const name of ['build.sh', 'refresh-install.sh', 'install-transaction.sh', 'record-install-transaction.js', 'check-app-target.js']) {
    await copyFile(join(scripts, name), join(fixtureScripts, name));
  }
  await copyFile(join(scripts, '../src/patches/custom-app-guard.js'), join(fixture, 'src/patches/custom-app-guard.js'));
  const stub = async (name, content) => {
    const path = join(fixtureScripts, name);
    await writeFile(path, content); await chmod(path, 0o700);
  };
  for (const name of ['check-dia-build.js', 'browser-process-guard.js', 'bridge-runtime.js']) await stub(name, '');
  await stub('mods.js', 'console.log("identity-isolation")');
  await stub('compatibility.js', 'console.log(JSON.stringify({ compatible: true }))');
  await stub('install.sh', `#!/bin/zsh
set -euo pipefail
[[ "$DIA_CUSTOM_STAGING" == 1 ]]
node "\${0:A:h}/check-app-target.js" install "$1"
print -n new > "$1/identity"
print install >> "$DIA_CUSTOM_TEST_LOG"
`);
  await stub('verify-staged.sh', `#!/bin/zsh
set -euo pipefail
node "\${0:A:h}/check-app-target.js" install "$1"
print verify >> "$DIA_CUSTOM_TEST_LOG"
if [[ "$1" == "$DIA_CUSTOM_APP" && "$DIA_CUSTOM_TEST_FAIL" == verify ]]; then exit 24; fi
`);
  await stub('configure-profile.sh', `#!/bin/zsh
print configure >> "$DIA_CUSTOM_TEST_LOG"
[[ "$DIA_CUSTOM_TEST_FAIL" != configure ]]
`);
  for (const operation of ['build', 'refresh']) for (const failure of ['none', 'verify', 'configure']) {
    const dir = join(root, `entry-${operation}-${failure}`), app = join(dir, 'Dia Custom Fixture.app');
    const source = join(dir, 'Dia.app'), profile = join(dir, 'profile'), state = join(profile, 'Bridge/.state');
    await mkdir(state, { recursive: true });
    for (const [path, bundle] of [[app, 'local.rttm.dia'], [source, 'company.thebrowser.dia']]) {
      await mkdir(join(path, 'Contents'), { recursive: true });
      await writeFile(join(path, 'identity'), 'old');
      await writeFile(join(path, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleName</key><string>Dia</string><key>DiaCustomEnabledMods</key><string>identity-isolation</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Dia</string></dict></array></dict></plist>`);
    }
    await writeFile(join(state, 'compatibility.json'), 'old compatibility');
    await writeFile(join(state, 'latest-install-transaction.json'), 'old transaction');
    const log = join(dir, 'calls');
    const result = spawnSync('/bin/zsh', [join(fixtureScripts, operation === 'build' ? 'build.sh' : 'refresh-install.sh'), operation === 'build' ? '--replace' : app], {
      encoding: 'utf8', env: { ...process.env, DIA_CUSTOM_APP: app, DIA_CUSTOM_SOURCE_APP: source, DIA_CUSTOM_PROFILE: profile,
        DIA_CUSTOM_STAGING: '1', DIA_CUSTOM_WORK_DIR: join(dir, 'work'), DIA_CUSTOM_TEST_LOG: log, DIA_CUSTOM_TEST_FAIL: failure },
    });
    assert.equal(result.status === 0, failure === 'none', `${operation}/${failure}: ${result.stderr}`);
    assert.equal(await readFile(join(app, 'identity'), 'utf8'), failure === 'none' ? 'new' : 'old', `${operation}/${failure}`);
    if (failure !== 'none') {
      assert.equal(await readFile(join(state, 'compatibility.json'), 'utf8'), 'old compatibility');
      assert.equal(await readFile(join(state, 'latest-install-transaction.json'), 'utf8'), 'old transaction');
    }
    const calls = (await readFile(log, 'utf8')).trim().split('\n');
    assert.deepEqual(calls, failure === 'verify' ? ['install', 'verify', 'verify'] : ['install', 'verify', 'verify', 'configure']);
  }
  process.stdout.write('ok    staged installs restore app, profile state and Finder preferences after failures and preserve running candidates\n');
} finally { await rm(root, { recursive: true, force: true }); }
