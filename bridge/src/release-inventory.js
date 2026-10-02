import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256, zipEntry } from './release-verification.js';

// Expected hashes come from the signed ZIP, never a mutable extracted inventory.
export async function verifyReleaseFiles(directory, inventory, { generated = false } = {}) {
  if (inventory.schemaVersion !== 1 || !inventory.files || typeof inventory.files !== 'object' || Array.isArray(inventory.files)) throw new Error('Invalid release file inventory');
  for (const [name, hash] of Object.entries(inventory.files)) {
    if (!name || name.startsWith('/') || /[\\\x00-\x1f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Unsafe release inventory');
    let current = directory;
    for (const part of name.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Release contains a symbolic link'); }
    if (sha256(await readFile(current)) !== hash) throw new Error(`Release file changed: ${name}`);
  }
  async function walk(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Release contains a symbolic link');
      if (generated && (name === '.build' || name === 'runtime')) continue;
      if (entry.isDirectory()) await walk(join(path, entry.name), name + '/');
      else if (name !== 'inventory.json' && !Object.hasOwn(inventory.files, name)) throw new Error(`Uninventoried release file: ${name}`);
    }
  }
  await walk(directory);
}

export async function verifyPreparedToolkit(job, manifest) {
  const bytes = await readFile(join(job, 'mods.zip'));
  if (bytes.length !== manifest.assets.mods.length || sha256(bytes) !== manifest.assets.mods.sha256) throw new Error('Prepared modifier archive changed');
  const inventory = JSON.parse(zipEntry(bytes, 'toolkit/inventory.json'));
  await verifyReleaseFiles(join(job, 'toolkit'), inventory, { generated: true });
  return inventory;
}
