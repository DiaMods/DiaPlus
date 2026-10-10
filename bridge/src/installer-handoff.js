import { lstat, open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { run } from './updater-common.js';

export const installationPhases = ['installing', 'closing', 'snapshotting', 'preflight', 'replacing', 'restarting'];
const environmentKeys = ['PATH', 'HOME', 'TMPDIR', 'DIA_CUSTOM_WORK_DIR', 'DIA_CUSTOM_STAGING'];
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function installerService(job, uid = process.getuid()) {
  if (typeof job !== 'string' || resolve(job) !== job || !Number.isInteger(uid) || uid < 0) throw new Error('Invalid installer service identity');
  const label = 'local.rttm.dia.install.' + createHash('sha256').update(job).digest('hex').slice(0, 24);
  return { label, target: `gui/${uid}/${label}`, domain: `gui/${uid}`, path: join(job, 'installer-service.plist') };
}

export function installerArguments(t, independent = true) {
  if (typeof t.node !== 'string' || resolve(t.node) !== t.node || t.toolkit !== join(t.job, 'toolkit')) throw new Error('Invalid installer executable paths');
  return [t.node, join(t.toolkit, 'bridge/src/update-worker.js'), join(t.job, 'transaction.json'), ...(independent ? ['--launchd-worker'] : [])];
}

// A detached POSIX child still belongs to its macOS launchd application/job.
// Loading a one-shot GUI-domain service gives it a separate lifetime. This is
// also invoked by the NEW downloaded worker when an OLD client dispatches it.
export async function handoffInstaller(t, { runImpl = run, uid = process.getuid() } = {}) {
  const service = installerService(t.job, uid);
  const args = installerArguments(t);
  const environment = Object.entries(t.env ?? {}).filter(([key, value]) => environmentKeys.includes(key) && typeof value === 'string');
  for (const value of [...args, ...environment.map(([, value]) => value)]) {
    if (value.length > 32768 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Invalid installer service metadata');
  }
  const log = join(t.job, 'install.log');
  const logFile = await open(log, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try {
    if (!(await logFile.stat()).isFile()) throw new Error('Invalid installer log');
    await logFile.chmod(0o600);
  } finally { await logFile.close(); }
  const data = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${xml(service.label)}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict>${environment.map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
<key>ProcessType</key><string>Interactive</string>
</dict></plist>`;
  await writeFile(service.path, data, { flag: 'wx', mode: 0o600 });
  await runImpl('/bin/launchctl', ['bootstrap', service.domain, service.path], { timeout: 15000 });
  return service;
}

export async function installerIsRunning(t, { runImpl = run, platform = process.platform, uid = process.getuid?.() } = {}) {
  const independent = installerArguments(t).join(' ');
  const initial = installerArguments(t, false).join(' ');
  // Match the entire executable/argv and job, not just a reusable PID or name.
  // Inspection failure propagates: it must never be interpreted as permission
  // to start another installer or recover a possibly-live transaction.
  const processes = await runImpl('/bin/ps', ['-axww', '-o', 'pid=,command='], { maxBytes: 16 * 1024 * 1024, timeout: 10000 });
  const found = processes.split('\n').some(line => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match && Number(match[1]) > 1 && [independent, initial].includes(match[2]);
  });
  if (found || platform !== 'darwin') return found;
  const service = installerService(t.job, uid);
  const exists = await lstat(service.path).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (!exists) return false; // Legacy detached worker, not a submitted service.
  let info;
  try { info = await runImpl('/bin/launchctl', ['print', service.target], { timeout: 10000 }); }
  catch (error) {
    if (/Could not find service/.test(error.message)) return false;
    throw error;
  }
  // A submitted service can be queued without a PID; do not race a slow first
  // start. A completed one-shot service stays registered but has no process.
  if (/\n\s*pid = \d+/.test(info) || /\n\s*state = running/.test(info)) throw new Error('Installer service process identity cannot be confirmed');
  if (/\n\s*runs = [1-9]\d*/.test(info) && /\n\s*last exit (?:code|status) =/.test(info)) return false;
  return true;
}
