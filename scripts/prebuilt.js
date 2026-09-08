import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function digestFiles(paths) {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(readFileSync(path));
  return hash.digest('hex');
}
export function prebuiltHelper(name, inputs = [], root = projectDirectory) {
  const manifestPath = join(root, 'prebuilt/manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('This Dia+ installer requires an Apple Silicon Mac.');
  }
  const inputHash = inputs.length ? digestFiles(inputs) : null;
  const entry = manifest.helpers.find(item => item.name === name && item.inputHash === inputHash);
  if (!entry || !/^[a-zA-Z0-9._-]+$/.test(entry.file)) {
    throw new Error(`No compatible precompiled ${name} helper. Install a newer Dia+ modifier release for this Dia build; the current app has been preserved.`);
  }
  const path = join(root, 'prebuilt', entry.file);
  if (digestFiles([path]) !== entry.sha256) throw new Error(`Dia+ ${name} helper checksum mismatch.`);
  return path;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prebuiltHelper(process.argv[2], process.argv.slice(3));
  if (result) process.stdout.write(`${result}\n`);
}
