#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const app = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("usage: patch-agent-handler.js /path/to/Dia Custom.app");
}
if (basename(dirname(app)) !== "work" || !basename(app).startsWith("Dia Custom")) {
  throw new Error(`refusing to patch a non-clone app: ${app}`);
}

const handler = resolve(
  app,
  "Contents/Resources/agent-server-resources/dist/handler",
);
const binary = await readFile(handler);
const processMonitorSources = [Buffer.from('SL("ps"'), Buffer.from('SL("ls"')];
const processMonitorReplacement = Buffer.from('SL("sh"');
const processMonitorOffsets = [];

for (const source of processMonitorSources) {
  for (let offset = binary.indexOf(source); offset !== -1; offset = binary.indexOf(source, offset + 1)) {
    processMonitorOffsets.push(offset);
  }
}

if (processMonitorOffsets.length !== 0 && processMonitorOffsets.length !== 2) {
  throw new Error(
    `expected exactly two process-monitor calls, found ${processMonitorOffsets.length}`,
  );
}

for (const offset of processMonitorOffsets) {
  processMonitorReplacement.copy(binary, offset);
}

// agent-server already launches this handler inside agent.sb. Applying the
// per-Claude profile from inside that Seatbelt sandbox fails on macOS with
// `forbidden-sandbox-reinit`. Reuse the parent agent server's existing sandbox
// by making the bundled-profile fallback resolve to null and disabling its
// required-profile assertion. Both substitutions preserve byte length.
const handlerPatches = [
  {
    // Dia's parent agent server currently exports the bundled profile path,
    // so ignore that explicit value as well as the fallback below.
    before: Buffer.from(
      'process.env.CLAUDE_CODE_SANDBOX_PROFILE || (() => {',
    ),
    after: Buffer.from(
      'process.env.CLAUDE_CODE_SANDBOX_PROFILE && (() => {',
    ),
  },
  {
    before: Buffer.from('return Km(B) ? B : null;'),
    after: Buffer.from('return Km(B) ? 0 : null;'),
  },
  {
    before: Buffer.from('H = true;'),
    after: Buffer.from('H =false;'),
  },
  {
    // Keep Dia's native context builder and Claude-compatible harness, but
    // send the resulting model request straight to the localhost bridge.
    before: Buffer.from(
      'ANTHROPIC_VERTEX_BASE_URL = `http://127.0.0.1:${H.port}`',
    ),
    after: Buffer.from(
      'ANTHROPIC_VERTEX_BASE_URL = `http://127.0.0.1:${8765  }`',
    ),
  },
  (() => {
    // The default Dia agent spec leaves its UI thinking stream disabled even
    // when the model returns Anthropic-compatible thinking blocks. Dia Custom
    // uses that existing UI for local provider activity summaries.
    const before = 'Z.settings?.env?.ENABLE_THINKING_STREAM === "true"';
    return {
      before: Buffer.from(before),
      after: Buffer.from("true".padEnd(before.length, " ")),
    };
  })(),
  (() => {
    // Dia's stock PreToolUse hook waits for a proprietary Watchtower result.
    // In the custom build, make that decision locally and immediately. The
    // currently exposed browser tools are read/search/open/close operations;
    // common mutation prefixes stay denied until a local confirmation UI is
    // added for them. Pad the replacement so the Bun binary layout is stable.
    const before =
      'Q.onCheck("permission", { tool: C, tool_use_id: N, ...M && { namespace: M }, input: I }, G(R))';
    const localDecision =
      'Promise.resolve(`{"decision":"${/^(creat|edit|delet|upload|send)/.test(C)?"deny":"allow"}"}`)';
    return {
      before: Buffer.from(before),
      after: Buffer.from(localDecision.padEnd(before.length, " ")),
    };
  })(),
];
let handlerPatchCount = 0;

for (const { before, after } of handlerPatches) {
  if (before.length !== after.length) {
    throw new Error("handler patches must preserve byte length");
  }
  const offset = binary.indexOf(before);
  if (offset === -1) {
    continue;
  }
  if (binary.indexOf(before, offset + 1) !== -1) {
    throw new Error(`sandbox patch source is not unique: ${before}`);
  }
  after.copy(binary, offset);
  handlerPatchCount += 1;
}

if (processMonitorOffsets.length === 0 && handlerPatchCount === 0) {
  process.stdout.write("Dia Custom agent handler patches are already applied.\n");
  process.exit(0);
}

await writeFile(handler, binary);
process.stdout.write(
  `Patched ${processMonitorOffsets.length} process-monitor calls and ${handlerPatchCount} handler sites in ${handler}.\n`,
);
