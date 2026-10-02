import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256, nodeArchive, nodeArchiveHash } from '../src/release-verification.js';
const keys = generateKeyPairSync('ed25519');
export const config = { repository: 'DiaMods/DiaPlus', clientID: 'Iv1.test-client', publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
export const source = { modRepository: config, distributionPrefix: 'https://releases.diabrowser.com/releases/', feedURL: 'https://releases.diabrowser.com/releases/feed.xml' };
export function bundle(changes = {}) {
  const manifest = { schemaVersion: 2, protocolVersion: 1, repository: config.repository, version: 'v0.2.0', tag: 'mods-v0.2.0', commit: 'a'.repeat(40), architecture: 'arm64', minimumMacOS: '14.0', installerVersion: 'v1.0.0', minimumInstallerVersion: 'v1.0.0', nodeArchive, nodeArchiveHash,
    dia: { build: '2', version: '1.2.0', length: 4, signature: Buffer.alloc(64).toString('base64'), url: source.distributionPrefix + 'Dia.zip' },
    compatibility: { build: '2', buildStatus: 'audited', perMod: [{ id: 'custom-updater', compatible: true }] },
    assets: { mods: { name: 'DiaPlus-Mods-v0.2.0-macOS-arm64.zip', length: 4, sha256: sha256(Buffer.from('test')) }, engine: { name: 'DiaPlus-Installer-v1.0.0-macOS-arm64.zip', length: 4, sha256: sha256(Buffer.from('test')) } }, ...changes };
  const bytes = Buffer.from(JSON.stringify(manifest));
  return { manifest, manifestBytes: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64') };
}
export function zip(entries) {
  let offset = 0;
  const local = [], central = [];
  for (const [name, value, type = 0x8000] of entries) {
    const path = Buffer.from(name), data = Buffer.from(value);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(path.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(3 * 256 + 20, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(path.length, 28); record.writeUInt32LE((type * 65536) >>> 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, path, data); central.push(record, path); offset += header.length + path.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export async function prepared(job, changes = {}) {
  const content = 'verified fixture', inventory = { schemaVersion: 1, files: { 'fixture.txt': sha256(Buffer.from(content)) } };
  const data = zip([['toolkit/fixture.txt', content], ['toolkit/inventory.json', JSON.stringify(inventory)]]);
  await mkdir(join(job, 'toolkit'), { recursive: true });
  await writeFile(join(job, 'mods.zip'), data); await writeFile(join(job, 'toolkit/fixture.txt'), content);
  await writeFile(join(job, 'toolkit/inventory.json'), JSON.stringify(inventory));
  const initial = bundle();
  return bundle({ ...changes, assets: { ...initial.manifest.assets, mods: { ...initial.manifest.assets.mods, length: data.length, sha256: sha256(data) } } });
}
