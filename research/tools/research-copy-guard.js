import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export async function requireResearchCopy(rootArg) {
  if (!rootArg) throw new Error('A prepared research root is required');
  const root = resolve(rootArg);
  const test = JSON.parse(await readFile(join(root, 'test.json')));
  if (test.root !== root || !test.bakedIsolation || !root.includes('/dia-browser-use-research-'))
    throw new Error('Expected baked-isolation research copy');
  const canonical = await realpath(root);
  for (const [key, name] of [['app', 'Dia+.Research.app'], ['profile', 'profile']]) {
    if (resolve(test[key] ?? '') !== join(root, name) ||
        await realpath(test[key]) !== join(canonical, name))
      throw new Error('Research ' + key + ' escaped its disposable root');
  }
  const plist = join(test.app, 'Contents/Info.plist');
  const read = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, plist], { encoding: 'utf8' }).trim();
  if (read('CFBundleIdentifier') !== 'local.rttm.dia.browser-use-research' || read('CFBundleVersion') !== '87864')
    throw new Error('Unexpected research application identity or build');
  return { root, test };
}
