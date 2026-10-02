import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { GitHubModReleases } from '../src/mod-release.js';
import { verifyModManifest, validateModifierZIP } from '../src/release-verification.js';
import { verifyPreparedToolkit } from '../src/release-inventory.js';
import { CustomUpdater, handleUpdaterAPI } from '../src/custom-updater.js';
import { saveJSON, loadJSON } from '../src/updater-common.js';
import { bundle, prepared, config, source, zip } from './release-fixtures.js';

test('signed release verification rejects tampered metadata, bad keys, required failures and unaudited builds', () => {
  const b = bundle();
  assert.equal(verifyModManifest(Buffer.from(b.manifestBytes, 'base64'), b.signature, config, source).version, 'v0.2.0');
  assert.throws(() => verifyModManifest(Buffer.from('{}'), b.signature, config, source), /signature/);
  assert.throws(() => verifyModManifest(Buffer.from(b.manifestBytes, 'base64'), b.signature, { publicKey: Buffer.alloc(32).toString('base64') }, source), /signature/);
  for (const changes of [
    { compatibility: { build: '2', buildStatus: 'audited', perMod: [{ id: 'required', required: true, compatible: false }] } },
    { compatibility: { build: '2', buildStatus: 'unknown', perMod: [{ id: 'core', compatible: true }] } },
    { dia: { ...b.manifest.dia, url: 'https://evil.test/Dia.zip' } },
    { protocolVersion: 2 }, { minimumInstallerVersion: 'v99.0.0' },
  ]) { const bad = bundle(changes); assert.throws(() => verifyModManifest(Buffer.from(bad.manifestBytes, 'base64'), bad.signature, config, source)); }
});
test('ZIP guard rejects traversal, links, duplicates, macOS case collisions and file/directory ambiguity', () => {
  assert.doesNotThrow(() => validateModifierZIP(zip([['toolkit/scripts/build.js', 'code']])));
  for (const entries of [
    [['toolkit/../evil', '']], [['/toolkit/a', '']], [['toolkit/a', '', 0xa000]], [['toolkit/a', ''], ['toolkit/a', '']],
    [['toolkit/A', ''], ['toolkit/a', '']], [['toolkit/a', ''], ['toolkit/a/b', '']], [['toolkit/a\\b', '']],
  ]) assert.throws(() => validateModifierZIP(zip(entries)));
});
test('prepared toolkit is checked against signed archive hashes, not a mutable extracted inventory', async t => {
  const job = await mkdtemp(join(tmpdir(), 'dia-private-inventory-')); t.after(() => rm(job, { recursive: true, force: true }));
  const b = await prepared(job); await verifyPreparedToolkit(job, b.manifest);
  await writeFile(join(job, 'toolkit/fixture.txt'), 'tampered');
  await writeFile(join(job, 'toolkit/inventory.json'), '{"schemaVersion":1,"files":{}}');
  await assert.rejects(verifyPreparedToolkit(job, b.manifest), /changed/);
});
test('Stable/Beta ignore drafts and engine tags; select the newest signed version for a requested build', async () => {
  const catalog = [
    { tag_name: 'mods-v0.9.0', draft: true }, { tag_name: 'installer-v1.0.0', draft: false },
    { tag_name: 'mods-v0.3.0', prerelease: true, draft: false, build: '3' },
    { tag_name: 'mods-v0.2.0', prerelease: false, draft: false, build: '2' },
    { tag_name: 'mods-v0.1.1', prerelease: false, draft: false, build: '1' },
  ];
  const releases = new GitHubModReleases({ auth: { api: async () => {}, json: async () => catalog }, config, source });
  releases.manifest = async release => ({ manifest: { version: release.tag_name.slice(5), dia: { build: release.build } } });
  assert.equal((await releases.latest()).manifest.version, 'v0.2.0');
  assert.equal((await releases.latest('beta')).manifest.version, 'v0.3.0');
  assert.equal((await releases.latest('stable', { build: '1' })).manifest.version, 'v0.1.1');
  assert.equal(await releases.latest('beta', { build: '9' }), null);
});
test('updater accepts a signed mod release without a standalone installer engine asset', async () => {
  const b = bundle(), bytes = Buffer.from(b.manifestBytes, 'base64');
  const signature = Buffer.from(b.signature);
  const releases = new GitHubModReleases({ auth: { api: async path => new Response(path.endsWith('/1') ? bytes : signature) }, config, source });
  const release = { id: 10, tag_name: b.manifest.tag, assets: [
    { id: 1, name: 'release-manifest.json', size: bytes.length },
    { id: 2, name: 'release-manifest.sig', size: signature.length },
    { id: 3, name: b.manifest.assets.mods.name, size: b.manifest.assets.mods.length },
  ] };
  const result = await releases.manifest(release);
  assert.equal(result.manifest.version, b.manifest.version);
  assert.equal(result.asset.id, 3);
  assert.deepEqual(result.manifest.assets.engine, b.manifest.assets.engine);
});
test('private asset authorization stays on GitHub API and never reaches redirect hosts', async () => {
  const calls = [];
  const releases = new GitHubModReleases({ auth: { api: async (path, options) => { calls.push({ path, options }); return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/test?temporary=1' } }); } }, config, source,
    fetchImpl: async (url, options) => { calls.push({ url, options }); assert(!options.headers?.authorization); return new Response('data'); } });
  assert.equal((await releases.asset({ id: 4, size: 4 }, 4)).toString(), 'data');
  assert.equal(calls[0].options.redirect, 'manual'); assert.equal(calls[1].options.redirect, 'manual');
  releases.auth.api = async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/download' } });
  await assert.rejects(releases.asset({ id: 4, size: 4 }, 4), /Unsafe/);
});
test('official Dia requests contain no GitHub authorization or redirect forwarding', async () => {
  const updater = new CustomUpdater({ bridgeDirectory: '/development/bridge', stateDirectory: '/unused', fetchImpl: async (url, options) => {
    assert(url.startsWith('https://releases.diabrowser.com/')); assert(!options.headers?.authorization); assert.equal(options.redirect, 'error');
    return new Response('feed');
  } });
  assert.equal((await updater.fetchBounded(source.feedURL, source, 100)).toString(), 'feed');
});
test('download rejects changed bundle bytes before extraction', async t => {
  const job = await mkdtemp(join(tmpdir(), 'dia-private-download-')); t.after(() => rm(job, { recursive: true, force: true }));
  const releases = new GitHubModReleases({ auth: { api: async () => new Response('evil') }, config, source });
  await assert.rejects(releases.download({ ...bundle(), asset: { id: 1, size: 4 } }, join(job, 'download.zip')), /checksum/);
});

async function updaterFixture(t, { currentBuild = '1', releases = null, denied = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dia-private-updater-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const app = join(directory, 'Dia+.app'); await mkdir(join(app, 'Contents'), { recursive: true });
  await writeFile(join(app, 'Contents/Info.plist'), `<plist version="1.0"><dict><key>CFBundleVersion</key><string>${currentBuild}</string><key>DiaCustomModVersion</key><string>v0.1.0</string><key>DiaCustomInstallerVersion</key><string>v1.0.0</string></dict></plist>`);
  const calls = [];
  const auth = { status: async () => ({ configured: true, signedIn: !denied, access: denied ? 'denied' : 'authorized' }), verifyAccess: async () => { calls.push('access'); if (denied) { const error = new Error('Repository access revoked'); error.code = 'access-denied'; throw error; } } };
  const updater = new CustomUpdater({ bridgeDirectory: '/development/bridge', profileDirectory: join(directory, 'profile'), stateDirectory: directory, isEnabled: () => true,
    modConfigStore: { publicState: async () => ({ mods: [{ id: 'custom-updater', configuredEnabled: true }] }) }, githubAuth: auth,
    modReleases: { latest: async (_, options) => { calls.push('mods'); return releases ? releases(options) : bundle(); } } });
  updater.app = app; updater.assertEnabled = async () => {}; updater.source = async () => source;
  updater.fetchBounded = async () => { calls.push('dia'); return Buffer.from(`<enclosure url="${source.distributionPrefix}Dia.zip" sparkle:version="2" sparkle:shortVersionString="1.2.0 (2)" length="4" sparkle:edSignature="${Buffer.alloc(64).toString('base64')}">`); };
  return { updater, calls, directory, auth };
}
test('unauthorized checks still report official Dia first but cannot prepare or install', async t => {
  const { updater, calls } = await updaterFixture(t, { denied: true });
  const state = await updater.check(); assert.equal(state.diaRelease.build, '2'); assert.deepEqual(calls, ['dia', 'access']);
  assert.equal(state.phase, 'blocked'); assert.equal(state.accessError, 'access-denied'); assert.deepEqual(state.options, []);
  await assert.rejects(updater.prepare('dia-and-mods')); await assert.rejects(updater.install());
});
test('same-build mod updates and audited combined updates remain separate explicit choices', async t => {
  const old = bundle(), same = bundle({ dia: { ...old.manifest.dia, build: '1' }, compatibility: { ...old.manifest.compatibility, build: '1' } });
  const { updater } = await updaterFixture(t, { releases: options => options?.build === '1' ? same : old });
  const state = await updater.check(); assert.deepEqual(state.options.map(option => option.kind), ['mods', 'dia-and-mods']);
  let target;
  updater.prepareJob = async (_, release, b) => { target = { release, b }; };
  await assert.rejects(updater.prepare(), /available compatible/);
  await updater.prepare('mods'); await updater.preparation;
  assert.equal(target.release.build, '1'); assert.equal(target.b.signature, same.signature);
});
test('unsupported newer Dia remains blocked and mod bundles cannot downgrade an installed build', async t => {
  const b = bundle(), same = bundle({ dia: { ...b.manifest.dia, build: '1' }, compatibility: { ...b.manifest.compatibility, build: '1' } });
  const { updater } = await updaterFixture(t, { currentBuild: '3', releases: () => same });
  assert.deepEqual((await updater.check()).options, []);
  const another = await updaterFixture(t, { releases: () => same }); const state = await another.updater.check();
  assert.equal(state.blockedDia !== null, true); assert(!state.options.some(option => option.kind === 'dia-and-mods'));
});
test('revoked repository access blocks a cached prepared installation before worker launch', async t => {
  const { updater, auth } = await updaterFixture(t); const job = join(updater.root, 'jobs/fixture'); await mkdir(job, { recursive: true });
  await saveJSON(join(job, 'transaction.json'), {}); await saveJSON(updater.statePath, { phase: 'ready', job, preparedMods: ['custom-updater'] });
  let validated = false; updater.validatePreparedTransaction = async () => { validated = true; };
  auth.verifyAccess = async () => { throw new Error('Access revoked'); };
  await assert.rejects(updater.install(), /revoked/); assert.equal(validated, false); assert.equal((await loadJSON(updater.statePath)).phase, 'ready');
});
test('channel changes invalidate cached jobs and every authentication operation requires local administration', async t => {
  const { updater } = await updaterFixture(t); await saveJSON(updater.statePath, { phase: 'ready', job: '/cached', bundle: bundle() });
  assert.equal((await updater.channel('beta')).channel, 'beta'); assert.equal((await loadJSON(updater.statePath)).job, null);
  await assert.rejects(updater.channel('invalid'));
  for (const [path, method] of [['/github/start','POST'], ['/github/poll','POST'], ['/github/cancel','POST'], ['/github/sign-out','POST'], ['/github/status','GET'], ['/channel','POST'], ['/prepare','POST'], ['/install','POST']]) {
    let result; await handleUpdaterAPI({ method }, {}, new URL('http://localhost/api/updater' + path), { updater: { authentication: () => { throw Error('must not run'); } }, hasAdminToken: async () => false, jsonResponse: (_, code, value) => { result = { code, value }; } }); assert.equal(result.code, 403);
  }
  let choice, result;
  const request = Readable.from(['{"kind":"mods"}']); request.method = 'POST';
  await handleUpdaterAPI(request, {}, new URL('http://localhost/api/updater/prepare'), { updater: { prepare: async kind => { choice = kind; return {}; } }, hasAdminToken: async () => true, jsonResponse: (_, code) => { result = code; } });
  assert.equal(result, 200); assert.equal(choice, 'mods');
});
