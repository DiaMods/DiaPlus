#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const app = resolve(process.argv[2] ?? "");
const mode = process.argv[3];
if (!process.argv[2] || !["on", "off"].includes(mode)) {
  throw new Error(
    "usage: toggle-agent-payload-logging.js /path/to/Dia Custom.app on|off",
  );
}

const executable = resolve(
  app,
  "Contents/Resources/agent-server-resources/dist/agent-server",
);
const binary = await readFile(executable);
const normal = Buffer.from(
  'Ix6 = process.env.MESSAGE_LOG_PAYLOADS === "1";',
);
const debugText = "Ix6 = true;".padEnd(normal.length, " ");
const debug = Buffer.from(debugText);
const before = mode === "on" ? normal : debug;
const after = mode === "on" ? debug : normal;
const offset = binary.indexOf(before);

if (offset === -1) {
  if (binary.indexOf(after) !== -1) {
    process.stdout.write(`Agent payload logging is already ${mode}.\n`);
    process.exit(0);
  }
  throw new Error("agent-server payload logging marker was not found");
}
if (binary.indexOf(before, offset + 1) !== -1) {
  throw new Error("agent-server payload logging marker is not unique");
}

after.copy(binary, offset);
await writeFile(executable, binary);
process.stdout.write(`Turned agent payload logging ${mode}.\n`);
