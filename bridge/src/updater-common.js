import { spawn } from 'node:child_process';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function saveJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export async function loadJSON(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function run(command, args, { env = process.env, cwd, timeout = 120000, maxBytes = 4 * 1024 * 1024, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', size = 0, stopped = null, killTimer = null;
    const kill = signal => {
      try {
        if (process.platform !== 'win32' && Number.isInteger(child.pid)) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
    };
    const stop = reason => {
      if (stopped) return;
      stopped = reason;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    const timer = setTimeout(() => stop(`timed out after ${timeout} ms`), timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      log?.write(chunk); size += chunk.length;
      output = (output + chunk.toString()).slice(-maxBytes);
      if (size > maxBytes && !log) stop(`exceeded its ${maxBytes}-byte output limit`);
    });
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      stopped ? reject(new Error(`${command} ${stopped}`))
        : code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed (${code}): ${output.slice(-3000)}`));
    });
  });
}
export async function plist(app, key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, `${app}/Contents/Info.plist`]);
}
export function allowedDownload(value, source) {
  const url = new URL(value), prefix = new URL(source.distributionPrefix);
  if (url.protocol !== 'https:' || url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname) ||
      url.username || url.password || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) {
    throw new Error('Update URL is outside the pinned official distribution');
  }
  return url.toString();
}
export function parseAppcast(xml, source) {
  if (xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsafe update feed');
  const releases = [];
  for (const match of xml.matchAll(/<enclosure\b([^>]*)>/g)) {
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    if (attributes['sparkle:deltaFrom'] || !attributes.url?.endsWith('.zip')) continue;
    const build = attributes['sparkle:version'], length = Number(attributes.length);
    const signature = attributes['sparkle:edSignature'];
    if (!/^\d{1,12}$/.test(build ?? '') || !Number.isSafeInteger(length) || length < 1 || length > 2 * 1024 ** 3 ||
        !/^[A-Za-z0-9+/]{86}==$/.test(signature ?? '')) throw new Error('Invalid signed update metadata');
    const url = allowedDownload(attributes.url, source);
    releases.push({ build, version: (attributes['sparkle:shortVersionString'] ?? build).split(' ')[0], length, signature, url });
  }
  if (!releases.length) throw new Error('The official feed contains no signed full release');
  return releases.sort((a, b) => Number(b.build) - Number(a.build))[0];
}
export function verifyArchive(bytes, release, source) {
  if (bytes.length !== release.length) throw new Error('Update download length does not match the signed release');
  const raw = Buffer.from(source.publicKey, 'base64');
  if (raw.length !== 32) throw new Error('Invalid pinned update signing key');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  if (!verify(null, bytes, key, Buffer.from(release.signature, 'base64'))) throw new Error('Official update signature verification failed');
}
export function validateArchivePaths(listing) {
  const entries = listing.split('\n').filter(Boolean);
  if (!entries.length || entries.some(path => path.startsWith('/') || path.includes('\\') ||
      path.split('/').some(part => part === '..') || !/^(Dia\.app\/|__MACOSX\/)/.test(path))) {
    throw new Error('The update archive has unexpected paths');
  }
}
export function requireAllMods(report, expected) {
  if (!report?.compatible || !Array.isArray(report.perMod) ||
      expected.some(id => !report.perMod.some(mod => mod.id === id && mod.compatible)) ||
      report.perMod.some(mod => !mod.compatible)) throw new Error('Update blocked: every enabled mod must pass compatibility checks');
}
