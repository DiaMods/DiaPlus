import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { allowedDownload, loadJSON, parseAppcast, plist, requireAllMods, run, saveJSON, validateArchivePaths, verifyArchive } from './updater-common.js';

export class CustomUpdater {
  constructor({ bridgeDirectory, profileDirectory, stateDirectory, modConfigStore, isEnabled, fetchImpl = fetch }) {
    Object.assign(this, { bridgeDirectory, profileDirectory, stateDirectory, modConfigStore, isEnabled, fetchImpl });
    this.app = bridgeDirectory.endsWith('/Contents/Resources/DiaCustomBridge') ? resolve(bridgeDirectory, '../../..') : null;
    this.root = profileDirectory ? `${resolve(profileDirectory)} Updates` : resolve(stateDirectory, 'updates');
    this.statePath = join(this.root, 'status.json');
    this.busy = false;
    this.stateWrites = Promise.resolve();
  }
  async configuredMods() {
    return (await this.modConfigStore.publicState()).mods.filter(m => m.configuredEnabled).map(m => m.id).sort();
  }
  async assertEnabled() {
    const configured = await this.configuredMods();
    if (!this.isEnabled() || !configured.includes('custom-updater')) throw new Error('Enable the Custom updater mod and restart Dia Custom');
    if (!this.app || !this.profileDirectory) throw new Error('The custom updater is available in the installed Dia Custom app');
    if (await plist(this.app, 'CFBundleIdentifier') !== 'local.rttm.dia') throw new Error('The updater can only replace Dia Custom');
  }
  async source() { return loadJSON(join(this.app, 'Contents/Resources/DiaCustomUpdater/src/config/updater-source.json')); }
  async status() {
    let state = await loadJSON(this.statePath, { phase: 'idle' });
    if (!this.busy && ['checking','downloading','verifying','validating','building'].includes(state.phase)) {
      state = { ...state, phase: 'failed', error: 'Update preparation was interrupted. Check and prepare the update again.' };
      await this.setState(state);
    }
    return { ...state, supported: Boolean(this.app && this.profileDirectory), enabled: this.isEnabled(),
      currentBuild: this.app ? await plist(this.app, 'CFBundleVersion') : null,
      modRepository: 'Local bundled mods; a remote mod repository is not configured.' };
  }
  async setState(patch) {
    const pending = this.stateWrites.then(async () => {
      const current = await loadJSON(this.statePath, {});
      await saveJSON(this.statePath, { ...current, ...patch, updatedAt: new Date().toISOString() });
    });
    this.stateWrites = pending.catch(() => {});
    return pending;
  }
  async fetchBounded(url, source, maxBytes, outputPath = null) {
    allowedDownload(url, source);
    const response = await this.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(outputPath ? 20 * 60_000 : 30_000) });
    if (!response.ok) throw new Error(`Official update server returned HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Update response exceeds size limit');
    const chunks = []; let size = 0;
    const file = outputPath ? await import('node:fs/promises').then(fs => fs.open(outputPath, 'wx', 0o600)) : null;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Update response exceeds size limit');
        if (file) await file.writeFile(chunk); else chunks.push(chunk);
      }
    } finally { await file?.close(); }
    return file ? size : Buffer.concat(chunks);
  }
  async check() {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true;
    let checking = false;
    try {
      const previous = await loadJSON(this.statePath, {});
      if (['installing','closing','recovery-required'].includes(previous.phase)) throw new Error('An installation is running or needs recovery; inspect its status first');
      checking = true;
      await this.setState({ phase: 'checking', error: null });
      const source = await this.source();
      const release = parseAppcast((await this.fetchBounded(source.feedURL, source, 2 * 1024 ** 2)).toString('utf8'), source);
      const current = Number(await plist(this.app, 'CFBundleVersion'));
      await this.setState({ phase: Number(release.build) > current ? (previous.phase === 'ready' && previous.release?.build === release.build && JSON.stringify(previous.preparedMods) === JSON.stringify(await this.configuredMods()) ? 'ready' : 'available') : 'current', release, checkedAt: new Date().toISOString() });
      return this.status();
    } catch (error) { if (checking) await this.setState({ phase: 'failed', error: error.message }); throw error; }
    finally { this.busy = false; }
  }
  async materialize(job) {
    const toolkit = join(job, 'toolkit');
    await cp(join(this.app, 'Contents/Resources/DiaCustomUpdater'), toolkit, { recursive: true, verbatimSymlinks: true });
    await cp(this.bridgeDirectory, join(toolkit, 'bridge'), { recursive: true, verbatimSymlinks: true, filter: path => !path.includes('/.state') });
    await mkdir(join(toolkit, '.build/runtime'), { recursive: true, mode: 0o700 });
    const archive = 'node-v24.20.0-darwin-arm64.tar.gz';
    await copyFile(join(toolkit, 'runtime', archive), join(toolkit, '.build/runtime', archive));
    await run('/usr/bin/tar', ['-xzf', join(toolkit, 'runtime', archive), '-C', join(toolkit, '.build/runtime')]);
    const bin = join(toolkit, '.build/runtime/node-v24.20.0-darwin-arm64/bin');
    return { toolkit, node: join(bin, 'node'), env: { ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`, DIA_CUSTOM_STAGING: '1', DIA_CUSTOM_WORK_DIR: join(job, 'work') } };
  }
  async prepare() {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true;
    try {
      const state = await loadJSON(this.statePath, {});
      if (!['available','failed'].includes(state.phase)) throw new Error('Check for updates before preparing a new build');
      if (!state.release || Number(state.release.build) <= Number(await plist(this.app, 'CFBundleVersion'))) throw new Error('Check for an available update first');
      const job = join(this.root, 'jobs', randomUUID());
      await mkdir(job, { recursive: true, mode: 0o700 });
      await this.setState({ phase: 'downloading', job, error: null });
      this.preparation = this.prepareJob(job, state.release).catch(async error => {
        await this.setState({ phase: 'failed', error: error.message });
      }).finally(() => { this.busy = false; });
      return this.status();
    } catch (error) { this.busy = false; throw error; }
  }
  async prepareJob(job, release) {
    const source = await this.source(), mods = await this.configuredMods();
    const archive = join(job, 'official.zip');
    await this.fetchBounded(release.url, source, release.length, archive);
    await this.setState({ phase: 'verifying' });
    verifyArchive(await readFile(archive), release, source);
    validateArchivePaths(await run('/usr/bin/unzip', ['-Z1', archive], { maxBytes: 32 * 1024 ** 2 }));
    const extracted = join(job, 'official');
    await run('/usr/bin/ditto', ['-xk', archive, extracted], { timeout: 300000 });
    const official = join(extracted, 'Dia.app');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', official], { timeout: 300000 });
    const signature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', official]);
    if (!signature.split('\n').includes(`TeamIdentifier=${source.teamID}`) ||
        await plist(official, 'CFBundleIdentifier') !== source.bundleID || await plist(official, 'CFBundleVersion') !== release.build ||
        await plist(official, 'CFBundleShortVersionString') !== release.version) throw new Error('The signed app does not match the pinned Dia publisher and release');
    const { toolkit, node, env } = await this.materialize(job);
    await run('/usr/bin/xcrun', ['--find', 'clang'], { env });
    await mkdir(join(job, 'work'), { recursive: true, mode: 0o700 });
    const candidate = join(job, 'Dia Custom RTTM.app');
    const buildEnv = { ...env, DIA_CUSTOM_MODS: mods.join(','), DIA_CUSTOM_EFFECTIVE_MODS: mods.join(','), DIA_CUSTOM_PROFILE: join(job, 'validation-profile'), DIA_CUSTOM_APP: candidate, DIA_CUSTOM_SOURCE_APP: official };
    await this.setState({ phase: 'validating' });
    const compatibility = JSON.parse(await run(node, [join(toolkit, 'scripts/compatibility.js'), official, '--mods', mods.join(','), '--json'], { env, timeout: 300000 }));
    requireAllMods(compatibility, mods);
    await saveJSON(join(job, 'compatibility.json'), compatibility);
    await this.setState({ phase: 'building', compatibility });
    const log = createWriteStream(join(job, 'build.log'), { mode: 0o600 });
    try { await run('/bin/zsh', [join(toolkit, 'scripts/build.sh')], { env: buildEnv, timeout: 30 * 60_000, log }); }
    finally { log.end(); }
    await run('/usr/bin/xcrun', ['swiftc', join(toolkit, 'src/updater/quit-app.swift'), '-o', join(job, 'quit-app')], { env, timeout: 120000 });
    if (JSON.stringify(await this.configuredMods()) !== JSON.stringify(mods)) throw new Error('Mods changed during preparation; check and prepare the update again');
    const runtimeID = await plist(candidate, 'DiaCustomBridgeRuntimeID');
    const transaction = { job, toolkit, node, env, app: await realpath(this.app), profile: await realpath(this.profileDirectory), candidate, mods, runtimeID, release, statePath: this.statePath };
    // Environment here excludes provider/connector credentials, which stay in the live profile.
    transaction.env = { PATH: env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, DIA_CUSTOM_WORK_DIR: env.DIA_CUSTOM_WORK_DIR, DIA_CUSTOM_STAGING: '1' };
    await saveJSON(join(job, 'transaction.json'), transaction);
    await this.setState({ phase: 'ready', job, compatibility, preparedMods: mods, runtimeID });
  }
  async install() {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true;
    let log = null, launching = false, dispatched = false;
    try {
      const state = await loadJSON(this.statePath, {});
      if (state.phase !== 'ready' || !state.job?.startsWith(`${this.root}/jobs/`)) throw new Error('Prepare and validate the update first');
      if (JSON.stringify(await this.configuredMods()) !== JSON.stringify(state.preparedMods)) throw new Error('Mods changed; prepare the update again');
      const transaction = await loadJSON(join(state.job, 'transaction.json'));
      await access(transaction.node);
      launching = true;
      await this.setState({ phase: 'installing', error: null });
      log = await import('node:fs').then(fs => fs.openSync(join(state.job, 'install.log'), 'a', 0o600));
      const worker = spawn(transaction.node, [join(transaction.toolkit, 'bridge/src/update-worker.js'), join(state.job, 'transaction.json')], { detached: true, stdio: ['ignore', log, log], env: transaction.env });
      await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
      worker.unref();
      dispatched = true;
      return { ok: true, phase: 'installing' };
    } catch (error) {
      if (launching && !dispatched) await this.setState({ phase: 'failed', error: `Could not start update installer: ${error.message}` });
      throw error;
    } finally {
      this.busy = false;
      if (log !== null) await import('node:fs').then(fs => fs.closeSync(log));
    }
  }
  start() {
    if (!this.app || !this.profileDirectory || !this.isEnabled() || process.env.DIA_CUSTOM_STAGING === '1' || process.env.DIA_CUSTOM_BRIDGE_PORT && process.env.DIA_CUSTOM_BRIDGE_PORT !== '8765') return;
    // Checking only advertises availability. Download and installation remain explicit actions.
    const check = async () => {
      try {
        const state = await loadJSON(this.statePath, {});
        if (!this.busy && ['idle','current','available','installed','failed',undefined].includes(state.phase) && Date.now() - (Date.parse(state.checkedAt) || 0) > 6 * 3600000) await this.check();
      } catch (error) { process.stderr.write(`Custom updater: ${error.message}\n`); }
    };
    this.timer = setInterval(check, 6 * 3600000); this.timer.unref();
    const first = setTimeout(check, 30000); first.unref();
  }
}

export async function handleUpdaterAPI(request, response, url, { updater, hasAdminToken, jsonResponse }) {
  if (!url.pathname.startsWith('/api/updater')) return false;
  try {
    if (!await hasAdminToken(request)) { jsonResponse(response, 403, { error: 'invalid local administration token' }); return true; }
    let value;
    if (request.method === 'GET' && url.pathname === '/api/updater') value = await updater.status();
    else if (request.method === 'POST' && url.pathname === '/api/updater/check') value = await updater.check();
    else if (request.method === 'POST' && url.pathname === '/api/updater/prepare') value = await updater.prepare();
    else if (request.method === 'POST' && url.pathname === '/api/updater/install') value = await updater.install();
    else { jsonResponse(response, 405, { error: 'method_not_allowed' }); return true; }
    jsonResponse(response, 200, value);
  } catch (error) { jsonResponse(response, 400, { error: error.message }); }
  return true;
}
