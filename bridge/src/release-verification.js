import { createHash, createPublicKey, verify } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { allowedDownload } from './download-origin.js';
const updateRepository = 'DiaMods/DiaPlus';

export const updateProtocol = 1;
export const nodeArchive = 'node-v24.20.0-darwin-arm64.tar.gz';
export const nodeArchiveHash = '40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8';
export function versionParts(value) {
  if (!/^v\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value ?? '')) throw new Error('Invalid modifier version');
  return value.slice(1).split('.').map(Number);
}
export function compareVersions(a, b) {
  const aa = versionParts(a), bb = versionParts(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function verifyModManifest(bytes, signature, config, source) {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Modifier manifest exceeds size limit');
  const raw = Buffer.from(config?.publicKey ?? '', 'base64');
  const sig = Buffer.from(String(signature).trim(), 'base64');
  if (raw.length !== 32 || sig.length !== 64 || !verify(null, bytes,
    createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' }), sig)) {
    throw new Error('Modifier release signature verification failed');
  }
  const m = JSON.parse(bytes);
  versionParts(m.version); versionParts(m.installerVersion); versionParts(m.minimumInstallerVersion);
  if (m.schemaVersion !== 2 || m.protocolVersion !== updateProtocol || m.repository !== updateRepository ||
      m.tag !== 'mods-' + m.version || !/^[0-9a-f]{40}$/.test(m.commit ?? '') || m.architecture !== 'arm64' ||
      !/^\d+\.\d+(?:\.\d+)?$/.test(m.minimumMacOS ?? '') || m.nodeArchive !== nodeArchive || m.nodeArchiveHash !== nodeArchiveHash) throw new Error('Unsupported modifier release metadata');
  const asset = m.assets?.mods;
  if (asset?.name !== `DiaPlus-Mods-${m.version}-macOS-arm64.zip` || !Number.isSafeInteger(asset.length) || asset.length < 1 ||
      asset.length > 1024 ** 3 || !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) throw new Error('Invalid modifier asset metadata');
  if (!/^\d{1,12}$/.test(m.dia?.build ?? '') || typeof m.dia.version !== 'string' || !Number.isSafeInteger(m.dia.length) ||
      m.dia.length < 1 || m.dia.length > 2 * 1024 ** 3 || !/^[A-Za-z0-9+/]{86}==$/.test(m.dia.signature ?? '')) throw new Error('Invalid official Dia metadata');
  allowedDownload(m.dia.url, source);
  if (m.compatibility?.buildStatus !== 'audited' || !Array.isArray(m.compatibility?.perMod) || !m.compatibility.perMod.length || String(m.compatibility.build) !== m.dia.build ||
      new Set(m.compatibility.perMod.map(mod => mod.id)).size !== m.compatibility.perMod.length ||
      m.compatibility.perMod.some(mod => typeof mod.id !== 'string' || typeof mod.compatible !== 'boolean' ||
        !mod.compatible && (mod.required || mod.criticality === 'critical'))) throw new Error('Modifier release has invalid or failed required compatibility');
  if (!m.assets.engine || !/^[0-9a-f]{64}$/.test(m.assets.engine.sha256 ?? '') || !Number.isSafeInteger(m.assets.engine.length) ||
      m.assets.engine.length < 1 || m.assets.engine.length > 1024 ** 3 ||
      compareVersions(m.minimumInstallerVersion, m.installerVersion) > 0 ||
      m.assets.engine.name !== `DiaPlus-Installer-${m.installerVersion}-macOS-arm64.zip`) throw new Error('Invalid installer metadata');
  return m;
}

// Inspect central-directory types before any native extraction. Reject links,
// duplicate entries, encryption, traversal, ZIP64, and unbounded expansion.
export function validateModifierZIP(data, prefix = 'toolkit/') {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) ||
      data.readUInt16LE(end + 8) !== data.readUInt16LE(end + 10)) throw new Error('Unsupported modifier ZIP directory');
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (!count || count === 65535 || start + size !== end) throw new Error('Invalid modifier ZIP directory');
  let cursor = start, expanded = 0;
  const seen = new Set(), entries = new Map();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid modifier ZIP entry');
    const length = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
    if (cursor + 46 + length + extra + comment > end) throw new Error('Invalid modifier ZIP entry length');
    const name = data.subarray(cursor + 46, cursor + 46 + length).toString('utf8');
    const type = (data.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
    if (!name.startsWith(prefix) || /[\\\x00-\x1f\x7f]/.test(name) ||
        name.split('/').some(part => part === '..' || part === '.') || name.includes('//') || seen.has(name.normalize('NFC').toLowerCase()) ||
        ![0, 0x8000, 0x4000].includes(type) || data.readUInt16LE(cursor + 8) & 1 ||
        ![0, 8].includes(data.readUInt16LE(cursor + 10)) || data.readUInt32LE(cursor + 42) >= start) throw new Error('Unsafe modifier ZIP entry');
    const local = data.readUInt32LE(cursor + 42);
    if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50 ||
        data.readUInt16LE(local + 6) !== data.readUInt16LE(cursor + 8) || data.readUInt16LE(local + 8) !== data.readUInt16LE(cursor + 10)) throw new Error('Modifier ZIP local header mismatch');
    const localLength = data.readUInt16LE(local + 26), localExtra = data.readUInt16LE(local + 28);
    if (data.subarray(local + 30, local + 30 + localLength).toString('utf8') !== name ||
        local + 30 + localLength + localExtra + data.readUInt32LE(cursor + 20) > start) throw new Error('Modifier ZIP local path mismatch');
    expanded += data.readUInt32LE(cursor + 24);
    if (expanded > 2 * 1024 ** 3 || data.readUInt32LE(cursor + 24) > 512 * 1024 ** 2) throw new Error('Modifier ZIP expansion limit exceeded');
    const offset = local + 30 + localLength + localExtra;
    entries.set(name, { offset, length: data.readUInt32LE(cursor + 20), expanded: data.readUInt32LE(cursor + 24), method: data.readUInt16LE(cursor + 10) });
    seen.add(name.normalize('NFC').toLowerCase()); cursor += 46 + length + extra + comment;
  }
  if (cursor !== end) throw new Error('Modifier ZIP directory mismatch');
  for (const name of entries.keys()) {
    const parts = name.replace(/\/$/, '').split('/');
    while (parts.length > 1) { parts.pop(); if (entries.has(parts.join('/'))) throw new Error('Modifier ZIP file/directory collision'); }
  }
  return entries;
}

export function zipEntry(data, name, prefix = 'toolkit/') {
  const entry = validateModifierZIP(data, prefix).get(name);
  if (!entry || entry.expanded > 4 * 1024 ** 2) throw new Error('Missing or oversized release inventory');
  const compressed = data.subarray(entry.offset, entry.offset + entry.length);
  const bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 4 * 1024 ** 2 });
  if (bytes.length !== entry.expanded) throw new Error('Release inventory size mismatch');
  return bytes;
}
