import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '../bridge/src/release-verification.js';

// The engine is a build/QA input and belongs only in its separate release.
// Its hash remains authenticated by the signed manifest and manual installer.
export function releaseChecksumFiles(manifest) {
  return [manifest.assets.mods.name, `DiaPlus-${manifest.version}-macOS-arm64.zip`,
    'release-manifest.json', 'release-manifest.sig'];
}

export async function releaseChecksums(directory, manifest) {
  return Buffer.from((await Promise.all(releaseChecksumFiles(manifest).map(async name =>
    `${sha256(await readFile(join(directory, name)))}  ${name}\n`))).join(''));
}
