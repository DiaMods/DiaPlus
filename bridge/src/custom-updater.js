import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GitHubKeychain, GitHubUpdateAuth, GitHubUpdateError } from './github-update-auth.js';
import { GitHubModReleases, verifyModManifest, compareVersions, nodeArchive, nodeArchiveHash, sha256 } from './mod-release.js';
import { verifyPreparedToolkit } from './release-inventory.js';
import { allowedDownload, loadJSON, parseAppcast, plist, requireAllMods, run, saveJSON, validateArchivePaths, verifyArchive } from './updater-common.js';

export class CustomUpdater {
  constructor({ bridgeDirectory, profileDirectory, stateDirectory, modConfigStore, isEnabled, fetchImpl = fetch, githubAuth = null, modReleases = null }) {
    Object.assign(this, { bridgeDirectory, profileDirectory, stateDirectory, modConfigStore, isEnabled, fetchImpl });
    this.app = bridgeDirectory.endsWith('/Contents/Resources/DiaCustomBridge') ? resolve(bridgeDirectory, '../../..') : null;
    this.root = profileDirectory ? `${resolve(profileDirectory)} Updates` : resolve(stateDirectory, 'updates');
    this.statePath = join(this.root, 'status.json');
    this.busy = false;
    this.stateWrites = Promise.resolve();
    this.githubAuth = githubAuth; this.modReleases = modReleases;
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
  async services() {
    const source = await this.source();
    const config = source?.modRepository ?? {};
    this.githubAuth ??= new GitHubUpdateAuth({ clientID: config.clientID,
      store: new GitHubKeychain(this.app ? join(this.app, 'Contents/Helpers/DiaCustomGitHubKeychain') : null), fetchImpl: this.fetchImpl });
    this.modReleases ??= new GitHubModReleases({ auth: this.githubAuth, config, source, fetchImpl: this.fetchImpl });
    return { auth: this.githubAuth, releases: this.modReleases, config, source };
  }
  async requireAccess() {
    const { auth, config } = await this.services();
    if (!config.clientID || !config.publicKey || config.repository !== 'DiaMods/DiaPlus') throw new GitHubUpdateError('configuration', 'The owner must configure the GitHub App and release-signing key. Use a manual installer until then.');
    return auth.verifyAccess();
  }
  async authentication(action) {
    await this.assertEnabled();
    if (this.busy && action !== 'status') throw new Error('Wait for the current update operation before changing GitHub authentication');
    const { auth } = await this.services();
    if (!['start', 'poll', 'cancel', 'signOut', 'status'].includes(action)) throw new Error('Invalid GitHub sign-in action');
    if (action === 'cancel') { auth.cancel(); return auth.status(); }
    return auth[action]();
  }
  async channel(value) {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    if (!['stable', 'beta'].includes(value)) throw new Error('Invalid update channel');
    const state = await loadJSON(this.statePath, {});
    if (['installing', 'closing', 'recovery-required'].includes(state.phase)) throw new Error('Resolve the current installation before changing channels');
    await this.setState({ channel: value, phase: 'idle', options: [], bundle: null, job: null, compatibility: null, error: null });
    return this.status();
  }
  async status() {
    let state = await loadJSON(this.statePath, { phase: 'idle' });
    if (!this.busy && ['checking','downloading','verifying','validating','building'].includes(state.phase)) {
      state = { ...state, phase: 'failed', error: 'Update preparation was interrupted. Check and prepare the update again.' };
      await this.setState(state);
    }
    let github = { configured: false, signedIn: false, access: 'configuration-required', repository: 'DiaMods/DiaPlus' };
    let auth;
    try { auth = (await this.services()).auth; github = await auth.status(); }
    catch (error) { github.configured = Boolean(auth?.clientID); github.access = 'keychain-error'; github.error = error.message; }
    return { ...state, github, channel: state.channel ?? 'stable', supported: Boolean(this.app && this.profileDirectory), enabled: this.isEnabled(),
      currentBuild: this.app ? await plist(this.app, 'CFBundleVersion') : null,
      currentModVersion: this.app ? await plist(this.app, 'DiaCustomModVersion').catch(() => 'v0.0.0') : null,
      modRepository: 'Private releases from DiaMods/DiaPlus. GitHub read access is required only for the updater.' };
  }
  async setState(patch) {
    const pending = this.stateWrites.then(async () => {
      const current = await loadJSON(this.statePath, {});
      await saveJSON(this.statePath, { ...current, ...patch, updatedAt: new Date().toISOString() });
    });
    this.stateWrites = pending.catch(() => {});
    return pending;
  }
  async fetchBounded(url, source, maxBytes, outputPath = null, onProgress = null) {
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
        if (onProgress) await onProgress(size);
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
      let release = null, diaError = null;
      try { release = parseAppcast((await this.fetchBounded(source.feedURL, source, 2 * 1024 ** 2)).toString('utf8'), source); }
      catch (error) { diaError = error.message; }
      const current = Number(await plist(this.app, 'CFBundleVersion'));
      const currentVersion = await plist(this.app, 'DiaCustomModVersion').catch(() => 'v0.0.0');
      let bundle = null, currentBundle = null, modError = null, accessError = null;
      try {
        await this.requireAccess();
        bundle = await (await this.services()).releases.latest(previous.channel ?? 'stable');
        currentBundle = bundle && bundle.manifest.dia.build === String(current) ? bundle :
          await (await this.services()).releases.latest(previous.channel ?? 'stable', { build: String(current) });
        if (bundle && compareVersions(bundle.manifest.minimumInstallerVersion,
          await plist(this.app, 'DiaCustomInstallerVersion').catch(() => 'v0.0.0')) > 0) throw new Error('Install a newer manual installer before using this modifier release.');
        if (currentBundle && compareVersions(currentBundle.manifest.minimumInstallerVersion,
          await plist(this.app, 'DiaCustomInstallerVersion').catch(() => 'v0.0.0')) > 0) currentBundle = null;
      } catch (error) { modError = error.message; accessError = error.code ?? 'release-error'; bundle = null; currentBundle = null; }
      const options = [];
      if (currentBundle?.manifest.dia.build === String(current) && compareVersions(currentBundle.manifest.version, currentVersion) > 0) options.push({ kind: 'mods', label: 'Update mods', targetBuild: String(current), modVersion: currentBundle.manifest.version, bundle: currentBundle });
      if (bundle) {
        const target = Number(bundle.manifest.dia.build);
        if (release && target === Number(release.build) && target > current && compareVersions(bundle.manifest.version, currentVersion) >= 0) options.push({ kind: 'dia-and-mods', label: 'Update Dia + mods', targetBuild: String(target), modVersion: bundle.manifest.version, bundle });
      }
      const blockedDia = release && Number(release.build) > current && !options.some(option => option.kind === 'dia-and-mods')
        ? 'The newer Dia build cannot be installed until a compatible, accessible mod release is published.' : null;
      const preparedConfiguration = Array.isArray(previous.compatibility?.requestedMods)
        ? [...previous.compatibility.requestedMods].sort()
        : previous.preparedMods;
      const selectedBundle = options.find(option => option.kind === previous.updateKind)?.bundle;
      const keepPrepared = options.length > 0 && previous.phase === 'ready' && selectedBundle &&
        previous.bundle?.signature === selectedBundle.signature && previous.bundle?.manifestBytes === selectedBundle.manifestBytes &&
        JSON.stringify(preparedConfiguration) === JSON.stringify(await this.configuredMods());
      const phase = options.length ? keepPrepared ? 'ready' : 'available' : diaError || modError ? 'blocked' : blockedDia ? 'blocked' : 'current';
      await this.setState({ phase, release: keepPrepared ? previous.release : release, diaRelease: release, diaError, modError, accessError, blockedDia, bundle: keepPrepared ? selectedBundle : bundle, options,
        error: [diaError, modError, blockedDia].filter(Boolean).join(' ') || null, checkedAt: new Date().toISOString(),
        ...(!keepPrepared ? {
          job: null, compatibility: null, disabledMods: null, preparedMods: null,
          runtimeID: null, download: null, rollbackError: null,
        } : {}),
      });
      return this.status();
    } catch (error) { if (checking) await this.setState({ phase: 'failed', error: error.message }); throw error; }
    finally { this.busy = false; }
  }
  jobContext(job) {
    const toolkit = join(job, 'toolkit');
    const bin = join(toolkit, '.build/runtime/node-v24.20.0-darwin-arm64/bin');
    return { toolkit, node: join(bin, 'node'), env: { ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`, DIA_CUSTOM_STAGING: '1', DIA_CUSTOM_WORK_DIR: join(job, 'work') } };
  }
  async materialize(job, bundle = null) {
    const { toolkit } = this.jobContext(job);
    if (bundle) {
      const { releases } = await this.services();
      const archive = join(job, 'mods.zip');
      await releases.download(bundle, archive);
      await run('/usr/bin/ditto', ['-xk', archive, job], { timeout: 300000 });
      await verifyPreparedToolkit(job, bundle.manifest);
      await mkdir(join(toolkit, 'runtime'), { recursive: true, mode: 0o700 });
      const existingRuntime = join(this.app, 'Contents/Resources/DiaCustomUpdater/runtime', nodeArchive);
      if (sha256(await readFile(existingRuntime)) !== nodeArchiveHash) throw new Error('Installed pinned Node archive checksum mismatch. Use a manual installer.');
      await copyFile(existingRuntime, join(toolkit, 'runtime', nodeArchive));
      // A signed bundle cannot silently rotate an installed trust anchor/app ID.
      const installedSource = await this.source();
      const candidateSource = await loadJSON(join(toolkit, 'src/config/updater-source.json'));
      if (JSON.stringify(candidateSource) !== JSON.stringify(installedSource)) throw new Error('Updater trust configuration changed. Use the new manual installer.');
    } else {
      await cp(join(this.app, 'Contents/Resources/DiaCustomUpdater'), toolkit, { recursive: true, verbatimSymlinks: true });
      await cp(this.bridgeDirectory, join(toolkit, 'bridge'), { recursive: true, verbatimSymlinks: true, filter: path => !path.includes('/.state') });
    }
    await mkdir(join(toolkit, '.build/runtime'), { recursive: true, mode: 0o700 });
    const archive = 'node-v24.20.0-darwin-arm64.tar.gz';
    await copyFile(join(toolkit, 'runtime', archive), join(toolkit, '.build/runtime', archive));
    await run('/usr/bin/tar', ['-xzf', join(toolkit, 'runtime', archive), '-C', join(toolkit, '.build/runtime')]);
    return this.jobContext(job);
  }
  async prepare(kind = null) {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true;
    try {
      const state = await loadJSON(this.statePath, {});
      if (!['available','failed'].includes(state.phase)) throw new Error('Check for updates before preparing a new build');
      await this.requireAccess();
      kind ??= state.options?.length === 1 ? state.options[0].kind : null;
      if (!state.options?.some(option => option.kind === kind) || !state.bundle) throw new Error('Check for an available compatible mod or Dia update first');
      const { config, source } = await this.services();
      const selected = state.options.find(option => option.kind === kind).bundle ?? state.bundle;
      const manifest = verifyModManifest(Buffer.from(selected.manifestBytes, 'base64'), selected.signature, config, source);
      const bundle = { ...selected, manifest };
      const release = manifest.dia;
      const current = Number(await plist(this.app, 'CFBundleVersion'));
      const currentMod = await plist(this.app, 'DiaCustomModVersion').catch(() => 'v0.0.0');
      if (compareVersions(manifest.version, currentMod) < (kind === 'mods' ? 1 : 0)) throw new Error('Refusing to downgrade or reinstall an older modifier version');
      if (kind === 'mods' && Number(release.build) !== current || kind === 'dia-and-mods' && Number(release.build) <= current) throw new Error('The prepared update would change or downgrade the wrong Dia build');
      if (kind === 'dia-and-mods' && state.diaRelease?.build !== release.build) throw new Error('The target no longer matches the checked official Dia release');
      const job = join(this.root, 'jobs', randomUUID());
      await mkdir(job, { recursive: true, mode: 0o700 });
      const startedAt = new Date().toISOString();
      await this.setState({ phase: 'downloading', job, release, bundle, updateKind: kind, error: null, compatibility: null, disabledMods: null,
        download: { receivedBytes: 0, totalBytes: release.length, percent: 0, startedAt } });
      this.preparation = this.prepareJob(job, release, bundle).catch(async error => {
        await this.setState({ phase: 'failed', error: error.message });
      }).finally(() => { this.busy = false; });
      return this.status();
    } catch (error) { this.busy = false; throw error; }
  }
  async prepareJob(job, release, bundle) {
    const source = await this.source(), mods = await this.configuredMods();
    const archive = join(job, 'official.zip');
    const startedAt = new Date().toISOString();
    let reportedPercent = -1;
    await this.fetchBounded(release.url, source, release.length, archive, async receivedBytes => {
      const percent = Math.min(100, Math.floor(receivedBytes * 100 / release.length));
      if (percent === reportedPercent && receivedBytes !== release.length) return;
      reportedPercent = percent;
      await this.setState({ download: { receivedBytes, totalBytes: release.length, percent, startedAt } });
    });
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
    const { toolkit, node, env } = await this.materialize(job, bundle);
    await mkdir(join(job, 'work'), { recursive: true, mode: 0o700 });
    await this.setState({ phase: 'validating' });
    const compatibility = JSON.parse(await run(node, [join(toolkit, 'scripts/compatibility.js'), official, '--mods', mods.join(','), '--json'], { env, timeout: 300000 }));
    await saveJSON(join(job, 'compatibility.json'), compatibility);
    await this.setState({ compatibility });
    const failures = Array.isArray(compatibility.perMod) ? compatibility.perMod.filter(mod => mods.includes(mod.id) && !mod.compatible) : [];
    const requiredFailures = failures.filter(mod => mod.required || mod.criticality === 'critical');
    if (requiredFailures.length) {
      throw new Error(`Update blocked: required mods are incompatible (${requiredFailures.map(mod => mod.label || mod.id).join(', ')})`);
    }
    requireAllMods(compatibility, mods.filter(id => !failures.some(mod => mod.id === id)));
    if (failures.length) {
      await this.setState({ phase: 'compatibility-review', compatibility, error: null });
      return;
    }
    await this.buildPreparedJob(job, release, compatibility, mods, mods);
  }
  async buildPreparedJob(job, release, compatibility, mods, requestedMods = mods) {
    requireAllMods(compatibility, mods);
    const { toolkit, node, env } = this.jobContext(job);
    const official = join(job, 'official', 'Dia.app');
    const candidate = join(job, 'Dia+.app');
    const buildEnv = { ...env, DIA_CUSTOM_MODS: requestedMods.join(','), DIA_CUSTOM_EFFECTIVE_MODS: mods.join(','), DIA_CUSTOM_PROFILE: join(job, 'validation-profile'), DIA_CUSTOM_APP: candidate, DIA_CUSTOM_SOURCE_APP: official };
    await this.setState({ phase: 'building', compatibility, error: null });
    const log = createWriteStream(join(job, 'build.log'), { mode: 0o600 });
    try { await run('/bin/zsh', [join(toolkit, 'scripts/build.sh')], { env: buildEnv, timeout: 30 * 60_000, log }); }
    finally { log.end(); }
    const quitHelper = await run(node, [join(toolkit, 'scripts/prebuilt.js'), 'quit-app'], { env });
    if (quitHelper) await copyFile(quitHelper, join(job, 'quit-app'));
    else await run('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos14.0', join(toolkit, 'src/updater/quit-app.swift'), '-o', join(job, 'quit-app')], { env, timeout: 120000 });
    if (JSON.stringify(await this.configuredMods()) !== JSON.stringify(requestedMods)) throw new Error('Mods changed during preparation; check and prepare the update again');
    const runtimeID = await plist(candidate, 'DiaCustomBridgeRuntimeID');
    const transaction = { job, toolkit, node, env, app: await realpath(this.app), profile: await realpath(this.profileDirectory), candidate, mods, requestedMods, runtimeID, release, statePath: this.statePath };
    const state = await loadJSON(this.statePath, {});
    transaction.bundle = state.bundle; transaction.channel = state.channel ?? 'stable'; transaction.updateKind = state.updateKind;
    // Environment here excludes provider/connector credentials, which stay in the live profile.
    transaction.env = { PATH: env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, DIA_CUSTOM_WORK_DIR: env.DIA_CUSTOM_WORK_DIR, DIA_CUSTOM_STAGING: '1' };
    await saveJSON(join(job, 'transaction.json'), transaction);
    await this.setState({ phase: 'ready', job, compatibility, preparedMods: mods, runtimeID });
  }
  async continueWithoutIncompatible() {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true;
    try {
      const state = await loadJSON(this.statePath, {});
      await this.requireAccess();
      if (state.phase !== 'compatibility-review' || typeof state.job !== 'string' ||
          !resolve(state.job).startsWith(`${resolve(this.root, 'jobs')}/`) || !state.release?.build ||
          String(state.compatibility?.build) !== String(state.release.build)) {
        throw new Error('There is no compatible partial update waiting for confirmation');
      }
      const failures = Array.isArray(state.compatibility?.perMod)
        ? state.compatibility.perMod.filter(mod => !mod.compatible)
        : [];
      if (!failures.length || failures.some(mod => mod.required || mod.criticality === 'critical')) {
        throw new Error('This update cannot continue without a required mod');
      }
      const requestedMods = Array.isArray(state.compatibility.requestedMods)
        ? [...state.compatibility.requestedMods].sort()
        : state.compatibility.perMod.map(mod => mod.id).sort();
      if (JSON.stringify(await this.configuredMods()) !== JSON.stringify(requestedMods)) {
        throw new Error('Mods changed during compatibility review; check and prepare the update again');
      }
      const mods = Array.isArray(state.compatibility.effectiveMods)
        ? [...state.compatibility.effectiveMods].sort()
        : state.compatibility.perMod.filter(mod => mod.compatible).map(mod => mod.id).sort();
      requireAllMods(state.compatibility, mods);
      const { config, source } = await this.services();
      const manifest = verifyModManifest(Buffer.from(state.bundle?.manifestBytes ?? '', 'base64'), state.bundle?.signature, config, source);
      await verifyPreparedToolkit(state.job, manifest);
      const disabledMods = failures.map(mod => mod.id);
      await this.setState({ phase: 'building', disabledMods, preparedMods: mods, error: null });
      this.preparation = this.buildPreparedJob(state.job, state.release, state.compatibility, mods, requestedMods).catch(async error => {
        await this.setState({ phase: 'failed', error: error.message });
      }).finally(() => { this.busy = false; });
      return this.status();
    } catch (error) { this.busy = false; throw error; }
  }
  async validatePreparedTransaction(state, transaction, expectedConfigured) {
    const { config, source } = await this.services();
    if (!transaction.bundle || transaction.channel !== (state.channel ?? 'stable') ||
        transaction.bundle.signature !== state.bundle?.signature || transaction.bundle.manifestBytes !== state.bundle?.manifestBytes ||
        transaction.updateKind !== state.updateKind) throw new Error('Prepared release identity or channel changed; prepare again');
    const manifest = verifyModManifest(Buffer.from(transaction.bundle.manifestBytes, 'base64'), transaction.bundle.signature, config, source);
    const current = Number(await plist(this.app, 'CFBundleVersion'));
    const currentMod = await plist(this.app, 'DiaCustomModVersion').catch(() => 'v0.0.0');
    if (transaction.updateKind === 'mods' ? Number(manifest.dia.build) !== current || compareVersions(manifest.version, currentMod) <= 0 :
        transaction.updateKind !== 'dia-and-mods' || Number(manifest.dia.build) <= current || compareVersions(manifest.version, currentMod) < 0) throw new Error('Installed versions changed; prepare a compatible update again');
    const context = this.jobContext(state.job);
    if (transaction.job !== state.job || transaction.toolkit !== context.toolkit || transaction.node !== context.node ||
        transaction.candidate !== join(state.job, 'Dia+.app') || transaction.statePath !== this.statePath ||
        transaction.app !== await realpath(this.app) || transaction.profile !== await realpath(this.profileDirectory) ||
        JSON.stringify(transaction.requestedMods) !== JSON.stringify(expectedConfigured)) throw new Error('Prepared installation paths or configuration changed');
    await verifyPreparedToolkit(state.job, manifest);
    transaction.bundle.manifest = manifest;
    // Never trust persisted subprocess environment or a modified runtime.
    const archive = join(context.toolkit, 'runtime', nodeArchive);
    if (sha256(await readFile(archive)) !== nodeArchiveHash) throw new Error('Prepared runtime checksum mismatch');
    const runtime = join(context.toolkit, '.build/runtime');
    if ((await import('node:fs/promises').then(fs => fs.lstat(runtime))).isSymbolicLink()) throw new Error('Unsafe prepared runtime');
    await import('node:fs/promises').then(fs => fs.rm(runtime, { recursive: true, force: true }));
    await mkdir(runtime, { mode: 0o700 });
    await run('/usr/bin/tar', ['-xzf', archive, '-C', runtime]);
    transaction.env = { PATH: context.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, DIA_CUSTOM_WORK_DIR: context.env.DIA_CUSTOM_WORK_DIR, DIA_CUSTOM_STAGING: '1' };
    await saveJSON(join(state.job, 'transaction.json'), transaction);
    const expectedBuild = manifest.dia.build;
    if (await plist(transaction.candidate, 'CFBundleVersion') !== expectedBuild ||
        await plist(transaction.candidate, 'DiaCustomModVersion') !== manifest.version) throw new Error('Prepared candidate version changed');
    const quit = await run(transaction.node, [join(transaction.toolkit, 'scripts/prebuilt.js'), 'quit-app'], { env: transaction.env });
    if (!quit || sha256(await readFile(join(state.job, 'quit-app'))) !== sha256(await readFile(quit))) throw new Error('Prepared quit helper changed');
    await access(transaction.node);
  }
  async install() {
    await this.assertEnabled();
    if (this.busy) throw new Error('An update operation is already running');
    this.busy = true;
    let log = null, launching = false, dispatched = false;
    try {
      const state = await loadJSON(this.statePath, {});
      if (state.phase !== 'ready' || typeof state.job !== 'string' || resolve(state.job) !== state.job ||
          !state.job.startsWith(`${this.root}/jobs/`) || !/^[a-zA-Z0-9_-]+$/.test(state.job.slice(`${this.root}/jobs/`.length))) throw new Error('Prepare and validate the update first');
      const expectedConfigured = Array.isArray(state.compatibility?.requestedMods) ? [...state.compatibility.requestedMods].sort() : state.preparedMods;
      if (JSON.stringify(await this.configuredMods()) !== JSON.stringify(expectedConfigured)) throw new Error('Mods changed; prepare the update again');
      const transaction = await loadJSON(join(state.job, 'transaction.json'));
      await this.requireAccess();
      await this.validatePreparedTransaction(state, transaction, expectedConfigured);
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
        if (!this.busy && ['idle','current','available','installed','failed','blocked',undefined].includes(state.phase) && Date.now() - (Date.parse(state.checkedAt) || 0) > 6 * 3600000) await this.check();
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
    let body = {};
    if (request.method === 'POST' && ['/api/updater/prepare', '/api/updater/channel'].includes(url.pathname)) {
      let text = '';
      for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 4096) throw new Error('Updater request is too large'); }
      body = text ? JSON.parse(text) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid updater request');
    }
    if (request.method === 'GET' && url.pathname === '/api/updater') value = await updater.status();
    else if (request.method === 'POST' && url.pathname === '/api/updater/check') value = await updater.check();
    else if (request.method === 'POST' && url.pathname === '/api/updater/prepare') value = await updater.prepare(body.kind);
    else if (request.method === 'POST' && url.pathname === '/api/updater/channel') value = await updater.channel(body.channel);
    else if (request.method === 'GET' && url.pathname === '/api/updater/github/status') value = await updater.authentication('status');
    else if (request.method === 'POST' && /^\/api\/updater\/github\/(start|poll|cancel|sign-out)$/.test(url.pathname)) value = await updater.authentication(url.pathname.endsWith('/sign-out') ? 'signOut' : url.pathname.split('/').at(-1));
    else if (request.method === 'POST' && url.pathname === '/api/updater/continue') value = await updater.continueWithoutIncompatible();
    else if (request.method === 'POST' && url.pathname === '/api/updater/install') value = await updater.install();
    else { jsonResponse(response, 405, { error: 'method_not_allowed' }); return true; }
    jsonResponse(response, 200, value);
  } catch (error) { jsonResponse(response, 400, { error: error.message, code: error.code ?? 'update-error' }); }
  return true;
}
