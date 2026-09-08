import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJSON, plist, run, saveJSON } from './updater-common.js';

// Kept separate from HTTP lifetime: this executable lives outside the app it replaces.
export async function installTransaction(t, overrides = {}) {
  const io = { cp, mkdir, rename, rm, stat, plist, run, saveJSON, ...overrides };
  const script = name => join(t.toolkit, 'scripts', name);
  const env = { ...t.env, DIA_CUSTOM_PROFILE: t.profile, DIA_CUSTOM_APP: t.app, DIA_CUSTOM_MODS: t.mods.join(','), DIA_CUSTOM_EFFECTIVE_MODS: t.mods.join(',') };
  const state = async patch => io.saveJSON(t.statePath, { ...(await loadJSON(t.statePath, {})), ...patch, updatedAt: new Date().toISOString() });
  const staged = join(dirname(t.app), `Dia Custom RTTM.update-${t.job.split('/').at(-1)}.app`);
  const backupApp = join(dirname(t.app), `.dia-custom-backups/Dia Custom RTTM.update-${t.job.split('/').at(-1)}.app`);
  const snapshot = join(t.job, 'profile-snapshot');
  const failedApp = `${t.app}.failed-update-${t.job.split('/').at(-1)}`;
  const failedProfile = `${t.profile}.failed-update-${t.job.split('/').at(-1)}`;
  async function assertModConfiguration() {
    const configuredEnv = { ...env };
    delete configuredEnv.DIA_CUSTOM_MODS; delete configuredEnv.DIA_CUSTOM_MODULES; delete configuredEnv.DIA_CUSTOM_EFFECTIVE_MODS;
    const configured = (await io.run(t.node, [script('mods.js'), 'resolved', '--profile', t.profile], { env: configuredEnv })).split(',').filter(Boolean).sort();
    if (JSON.stringify(configured) !== JSON.stringify([...t.mods].sort())) throw new Error('Mods changed after update preparation');
  }
  let closed = false, swapped = false, preservedApp = false, snapshotted = false;
  try {
    if (!t.app.endsWith('.app') || !t.profile || t.app.includes('/Dia.app') || await io.plist(t.app, 'CFBundleIdentifier') !== 'local.rttm.dia') throw new Error('Refusing to replace a non-custom app');
    if (await io.plist(t.candidate, 'CFBundleIdentifier') !== 'local.rttm.dia' || await io.plist(t.candidate, 'DiaCustomBridgeRuntimeID') !== t.runtimeID) throw new Error('Prepared app identity changed');
    await assertModConfiguration();
    await io.run('/bin/zsh', [script('verify-staged.sh'), t.candidate, t.mods.join(',')], { env });
    await io.cp(t.candidate, staged, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await state({ phase: 'closing', error: null });
    // NSRunningApplication honors unsaved work and quit cancellation. Never force quit.
    await io.run(join(t.job, 'quit-app'), [t.app], { env, timeout: 50000 });
    closed = true;
    await io.run('/bin/launchctl', ['remove', 'local.rttm.dia.bridge'], { env }).catch(() => {});
    await io.run(t.node, [script('bridge-runtime.js'), 'stop', t.app], { env });
    await io.run(t.node, [script('browser-process-guard.js'), 'assert-stopped', t.app, t.profile], { env });
    await io.run('/bin/cp', ['-cR', t.profile, snapshot], { env, timeout: 300000 });
    snapshotted = true;
    if (await io.stat(join(snapshot, 'User Data/Local State')).then(() => true).catch(() => false)) {
      await io.run('/bin/zsh', [script('preflight-profile.sh'), staged, snapshot], { env, timeout: 180000 });
    }
    await assertModConfiguration();
    await io.run(t.node, [script('browser-process-guard.js'), 'assert-stopped', t.app, t.profile], { env });
    await io.saveJSON(join(t.job, 'rollback.json'), { version: 1, installedApp: t.app, backupApp, profile: t.profile, profileSnapshot: snapshot, createdAt: new Date().toISOString() });
    await io.mkdir(dirname(backupApp), { recursive: true, mode: 0o700 });
    await io.rename(t.app, backupApp); preservedApp = true;
    await io.rename(staged, t.app); swapped = true;
    await io.run('/bin/zsh', [script('verify-staged.sh'), t.app, t.mods.join(',')], { env });
    await io.mkdir(join(t.profile, 'Bridge/.state'), { recursive: true, mode: 0o700 });
    await io.cp(join(t.job, 'compatibility.json'), join(t.profile, 'Bridge/.state/compatibility.json'));
    await io.cp(join(t.job, 'rollback.json'), join(t.profile, 'Bridge/.state/latest-install-transaction.json'));
    await io.run('/bin/zsh', [script('launch.sh')], { env: { ...env, DIA_CUSTOM_STAGING: '0' }, timeout: 120000 });
    // launch.sh checks runtime, profile, mod identities; also require the browser to stay alive.
    await io.run('/bin/sleep', ['3']);
    const processes = JSON.parse(await io.run(t.node, [script('browser-process-guard.js'), 'list', t.app], { env }));
    if (!Array.isArray(processes) || processes.length === 0) throw new Error('Updated browser exited after launch');
    await state({ phase: 'installed', installedAt: new Date().toISOString(), backupApp, profileSnapshot: snapshot, error: null });
  } catch (error) {
    let rollbackError = null;
    try {
      if (swapped) {
        await io.run(join(t.job, 'quit-app'), [t.app], { env, timeout: 50000 });
        await io.run('/bin/launchctl', ['remove', 'local.rttm.dia.bridge'], { env }).catch(() => {});
        await io.run(t.node, [script('bridge-runtime.js'), 'stop', t.app], { env });
        await io.run(t.node, [script('browser-process-guard.js'), 'assert-stopped', t.app, t.profile], { env });
        await io.rename(t.app, failedApp);
      }
      if (preservedApp) await io.rename(backupApp, t.app);
      if (swapped && snapshotted) {
        await io.rename(t.profile, failedProfile);
        await io.run('/bin/cp', ['-cR', snapshot, t.profile], { env, timeout: 300000 });
      }
      if (closed) await io.run('/bin/zsh', [script('launch.sh')], { env: { ...env, DIA_CUSTOM_STAGING: '0' }, timeout: 120000 });
    } catch (failure) { rollbackError = failure.message; }
    if (!swapped) {
      try {
        const stagedExists = await io.stat(staged).then(() => true, failure => {
          if (failure.code === 'ENOENT') return false;
          throw failure;
        });
        if (stagedExists) {
          await io.run(t.node, [script('browser-process-guard.js'), 'assert-stopped', staged], { env });
          await io.rm(staged, { recursive: true, force: true });
        }
      } catch (failure) { rollbackError ??= `Staged app preserved at ${staged}: ${failure.message}`; }
    }
    await state({ phase: rollbackError ? 'recovery-required' : 'failed', error: error.message, rollbackError, backupApp, profileSnapshot: snapshotted ? snapshot : null });
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await installTransaction(await loadJSON(resolve(process.argv[2]))); }
  catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }
}
