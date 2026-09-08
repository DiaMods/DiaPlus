import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

const baselineEnvironment = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "PATH"];
const unsafeEnvironment = /^(?:NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|BASH_ENV|ENV|SHELLOPTS|LD_.*|DYLD_.*)$/i;

export function validateEnvironmentKeys(value = []) {
  if (!Array.isArray(value) || value.length > 64 || value.some((key) =>
    typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key) || unsafeEnvironment.test(key))) {
    throw new Error("Local connector environment must list at most 64 variable names; runtime injection variables are forbidden");
  }
  return [...new Set(value)];
}

export function validateLocalProcess(value) {
  if (typeof value.command !== "string" || !isAbsolute(value.command) || /[\0\r\n]/.test(value.command)) {
    throw new Error("Local connector command must be an absolute executable path");
  }
  const args = value.args ?? [];
  if (!Array.isArray(args) || args.length > 128 || args.some((arg) => typeof arg !== "string" || arg.length > 16000 || /\0/.test(arg))) {
    throw new Error("Local connector args must be an array of at most 128 strings");
  }
  if (value.cwd !== undefined && (typeof value.cwd !== "string" || !isAbsolute(value.cwd) || /[\0\r\n]/.test(value.cwd))) {
    throw new Error("Local connector working directory must be an absolute path");
  }
  const timeoutMs = value.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error("Local connector timeoutMs must be 100–120000");
  return { command: value.command, args: [...args], ...(value.cwd ? { cwd: value.cwd } : {}),
    envKeys: validateEnvironmentKeys(value.envKeys), timeoutMs };
}

export function processEnvironment(manifest, secrets = {}) {
  const permitted = new Set([...baselineEnvironment, ...validateEnvironmentKeys(manifest.envKeys)]);
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) throw new Error("Connector environment must be an object");
  for (const [key, value] of Object.entries(secrets)) {
    if (!manifest.envKeys?.includes(key) || typeof value !== "string" || value.length > 16000 || value.includes("\0")) {
      throw new Error("Connector environment values must match the configured envKeys");
    }
  }
  return Object.fromEntries([...permitted].flatMap((key) => {
    const value = secrets[key] ?? process.env[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

export async function runLocalProcess(manifest, args, { environment = {}, execFileImplementation = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImplementation(manifest.command, args, {
      cwd: manifest.cwd, env: processEnvironment(manifest, environment), shell: false,
      timeout: manifest.timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, encoding: "utf8",
    }, (error, stdout) => {
      if (error) reject(new Error(error.code === "ENOENT" ? "Connector executable was not found; check its absolute path"
        : error.killed ? "Connector process timed out or exceeded its output limit"
          : "Connector process failed; check its account access and arguments"));
      else resolve(stdout);
    });
  });
}
