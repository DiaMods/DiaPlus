import { open, readFile } from 'node:fs/promises';
import { GitHubUpdateError, updateRepository } from './github-update-auth.js';
import { verifyModManifest, compareVersions, sha256, validateModifierZIP } from './release-verification.js';
export * from './release-verification.js';

export class GitHubModReleases {
  constructor({ auth, config, source, fetchImpl = fetch }) { Object.assign(this, { auth, config, source, fetchImpl }); }
  async asset(asset, maximum, output = null) {
    if (!Number.isSafeInteger(asset?.id) || asset.id < 1 || !Number.isSafeInteger(asset.size) || asset.size > maximum || asset.size < 1) throw new Error('Invalid private release asset');
    let response = await this.auth.api(`/repos/${updateRepository}/releases/assets/${asset.id}`, { redirect: 'manual', headers: { accept: 'application/octet-stream' } });
    for (let redirects = 0; response.status >= 300 && response.status < 400; redirects++) {
      if (redirects >= 3) throw new Error('Too many release asset redirects');
      let url;
      try { url = new URL(response.headers.get('location')); } catch { throw new Error('Unsafe release asset redirect'); }
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) throw new Error('Unsafe release asset redirect');
      try { response = await this.fetchImpl(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(120000) }); }
      catch { throw new GitHubUpdateError('network', 'GitHub asset download failed. Try again later.'); }
    }
    if (!response.ok) throw new Error('Private release asset download failed');
    const file = output ? await open(output, 'wx', 0o600) : null;
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length; if (size > maximum || size > asset.size) throw new Error('Private release asset exceeds its size limit');
        if (file) await file.writeFile(chunk); else chunks.push(chunk);
      }
    } finally { await file?.close(); }
    if (size !== asset.size) throw new Error('Private release asset length mismatch');
    return file ? size : Buffer.concat(chunks);
  }
  async manifest(release) {
    const entries = name => release.assets?.filter(asset => asset.name === name) ?? [];
    if (entries('release-manifest.json').length !== 1 || entries('release-manifest.sig').length !== 1) throw new Error('Release is missing its signed manifest');
    const bytes = await this.asset(entries('release-manifest.json')[0], 2 * 1024 ** 2);
    const signature = await this.asset(entries('release-manifest.sig')[0], 256);
    const manifest = verifyModManifest(bytes, signature.toString('utf8'), this.config, this.source);
    if (release.tag_name !== manifest.tag) throw new Error('Release tag does not match its signature');
    const assets = entries(manifest.assets.mods.name);
    if (assets.length !== 1 || assets[0].size !== manifest.assets.mods.length) throw new Error('Modifier release asset is missing or changed');
    return { manifest, asset: { id: assets[0].id, size: assets[0].size, name: assets[0].name },
      manifestBytes: bytes.toString('base64'), signature: signature.toString('utf8').trim(), releaseID: release.id };
  }
  async latest(channel = 'stable', { build = null } = {}) {
    if (!['stable', 'beta'].includes(channel)) throw new Error('Invalid update channel');
    const releases = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.auth.api(`/repos/${updateRepository}/releases`, { query: { per_page: '100', page: String(page) } });
      const list = await this.auth.json(response, 2 * 1024 ** 2);
      if (!Array.isArray(list)) throw new Error('Invalid GitHub release catalog');
      for (const release of list) {
        if (release.draft || channel === 'stable' && release.prerelease || !/^mods-v\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(release.tag_name ?? '')) continue;
        releases.push(release);
      }
      if (list.length < 100) break;
      if (page === 10) throw new Error('GitHub release catalog pagination limit exceeded');
    }
    releases.sort((a, b) => compareVersions(b.tag_name.slice(5), a.tag_name.slice(5)));
    if (!releases.length) return null;
    for (const release of releases) {
      const bundle = await this.manifest(release);
      if (!build || bundle.manifest.dia.build === build) return bundle;
    }
    return null;
  }
  async download(bundle, output) {
    await this.asset(bundle.asset, bundle.manifest.assets.mods.length, output);
    const bytes = await readFile(output);
    if (sha256(bytes) !== bundle.manifest.assets.mods.sha256) throw new Error('Modifier bundle checksum mismatch');
    validateModifierZIP(bytes);
  }
}
