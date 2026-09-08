#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

function normalizedPath(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

export function assertBridgeHealth(health, runtimeID, profile, mods) {
  if (health?.ok !== true || health.coreReady !== true || !(health.catalog?.modelCount > 0)) {
    throw new Error("local bridge has not finished core/model startup");
  }
  if (!runtimeID || health.runtimeID !== runtimeID) {
    throw new Error("port is served by a different or outdated bridge runtime");
  }
  if (typeof health.profileDirectory !== "string" ||
      normalizedPath(health.profileDirectory) !== normalizedPath(profile)) {
    throw new Error("port is served by a bridge for a different profile");
  }
  const expected = [...new Set(mods.split(",").filter(Boolean))].sort();
  if (!Array.isArray(health.enabledMods) ||
      JSON.stringify([...health.enabledMods].sort()) !== JSON.stringify(expected)) {
    throw new Error("port is served by a bridge with a different Dia Mods configuration");
  }
}

export async function stopBundledBridge(app) {
  const expected = `${join(app, "Contents/Helpers/DiaCustomNode")} ` +
    join(app, "Contents/Resources/DiaCustomBridge/src/server.js");
  const processes = execFileSync("/bin/ps", ["-axww", "-o", "pid=,command="], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const pids = processes.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match && Number(match[1]) > 1 && match[2] === expected ? [Number(match[1])] : [];
  });
  for (const pid of pids) {
    let command;
    try {
      command = execFileSync("/bin/ps", ["-ww", "-o", "command=", "-p", String(pid)], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch { continue; }
    if (command !== expected) continue;
    try { process.kill(pid, "SIGTERM"); } catch (error) {
      if (error.code === "ESRCH") continue;
      throw error;
    }
    const deadline = Date.now() + 3000;
    while (true) {
      try { process.kill(pid, 0); } catch (error) {
        if (error.code === "ESRCH") break;
        throw error;
      }
      if (Date.now() >= deadline) throw new Error(`bundled bridge ${pid} did not stop; quit it before continuing`);
      await setTimeout(100);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "stop" && args.length === 1) {
    await stopBundledBridge(args[0]);
  } else if (command === "check-health" && args.length === 3) {
    try {
      assertBridgeHealth(JSON.parse(readFileSync(0, "utf8")), ...args);
    } catch (error) {
      process.stderr.write(`Dia Custom bridge: ${error.message}\n`);
      process.exitCode = 1;
    }
  } else {
    throw new Error("usage: bridge-runtime.js stop APP | check-health RUNTIME_ID PROFILE MODS");
  }
}
