#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const patcher = join(scripts, "../src/patches/patch-agent-handler.js");
const source = resolve(process.argv[2] ?? "/Applications/Dia.app");
const directory = await mkdtemp(join(tmpdir(), "dia-custom-handler-"));
const app = join(directory, "Dia Custom Handler Fixture.app");
const handlerRelative = "Contents/Resources/agent-server-resources/dist/handler";
const handler = join(app, handlerRelative);
const run = (...args) => execFileSync(process.execPath, [patcher, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const hash = (value) => createHash("sha256").update(value).digest("hex");

try {
  await mkdir(dirname(handler), { recursive: true });
  await copyFile(join(source, handlerRelative), handler);
  await writeFile(join(app, "Contents/Info.plist"),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.rttm.dia</string></dict></plist>');
  const original = await readFile(handler);
  run("--check", app);
  assert.equal(hash(await readFile(handler)), hash(original), "source checks must stay read-only");
  assert.throws(() => run("--check", "--require-patched", app), /required patch is missing/);
  run(app);
  const patched = await readFile(handler);
  assert.equal(patched.length, original.length, "Bun executable offsets must remain unchanged");
  run("--check", "--require-patched", app);
  run(app);
  assert.equal(hash(await readFile(handler)), hash(patched), "patching must be idempotent");

  const permissionBefore = 'X.onCheck("permission", { tool: N, tool_use_id: I, ...M && { namespace: M }, input: P }, K(R)).catch(() => null)';
  const permissionOffset = original.indexOf(permissionBefore);
  assert.ok(permissionOffset >= 0, "86584 native permission fixture must be recognized");
  const permissionExpression = patched.subarray(permissionOffset, permissionOffset + permissionBefore.length).toString().trim();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const permission = new AsyncFunction("X", "N", "I", "M", "P", "K", "R", `return await ${permissionExpression};`);
  const notifications = [];
  const decision = await Promise.race([
    permission({ onCheck: (...args) => { notifications.push(args); return new Promise(() => {}); } },
      "ToolSearch", "tool-1", "dia", { query: "open_tabs" }, (state) => ({ turn: state.id }), { id: "turn-1" }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("local permission waited for the hosted verdict")), 100)),
  ]);
  assert.deepEqual(JSON.parse(decision), { decision: "allow" });
  assert.deepEqual(notifications, [["permission", {
    tool: "ToolSearch", tool_use_id: "tool-1", namespace: "dia", input: { query: "open_tabs" },
  }, { turn: "turn-1" }]]);

  const callbackOffset = original.indexOf("async (l, C$) => {");
  const callbackEnd = original.indexOf("}, Wx6(b,", callbackOffset) + 1;
  assert.ok(callbackOffset >= 0 && callbackEnd > callbackOffset);
  const callbackExpression = patched.subarray(callbackOffset, callbackEnd).toString().trim();
  for (const [namespace, tool, local] of [
    ["dia", "search_web", true], ["dia", "fetch_web_content", true],
    ["dia", "read_tabs", false], ["dia", "open_tabs", false],
    ["custom", "search_web", false], ["dia", "search_web_extra", false],
  ]) {
    const nativeCalls = [], fetchCalls = [], registrations = [];
    const callback = new Function("j", "d", "Gx6", "X", "b", "W", "I", "Q", "fetch", `return (${callbackExpression});`)(
      new Set(), tool, (...args) => registrations.push(args), "emitter", "definition",
      () => ({ nativeContext: "context-1" }), namespace,
      { onTool: async (...args) => { nativeCalls.push(args); return "native-result"; } },
      async (...args) => { fetchCalls.push(args); return { ok: true, text: async () => "local-result" }; },
    );
    const input = { query: "fixture" };
    const result = await callback(input, { _meta: { "claudecode/toolUseId": "tool-2" } });
    assert.deepEqual(result, { content: [{ type: "text", text: local ? "local-result" : "native-result" }] });
    assert.deepEqual(nativeCalls, [[tool, input, namespace, { nativeContext: "context-1", toolUseId: "tool-2" }]]);
    assert.equal(registrations.length, 1);
    assert.equal(fetchCalls.length, local ? 1 : 0);
    if (local) {
      assert.equal(fetchCalls[0][0], "http://127.0.0.1:8765/t");
      assert.deepEqual(JSON.parse(fetchCalls[0][1].body), { n: tool, i: input });
    }
  }

  for (const boundary of [
    'X.onCheck("user_question", { input: L }, K(W()))',
    'permissionMode: "default", canUseTool: u8.canUseTool',
    'CLAUDE_CODE_SANDBOX_PROFILE || (() => {',
    'let u = Vm$(SC4(G, "artifacts")) + yC4;\n  function e(d) {\n    return Vm$(d).startsWith(u);\n  }',
  ]) {
    assert.ok(original.includes(boundary), "native boundary exists in the official fixture");
    assert.ok(patched.includes(boundary), "native boundary must remain intact");
  }
  for (const name of ["bC4", "bJ$", "CJ$"]) {
    const start = original.indexOf(`function ${name}(`);
    const end = original.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start);
    assert.ok(patched.includes(original.subarray(start, end)),
      `${name}: native question validation, file URL and Bash safeguards must remain intact`);
  }
  process.stdout.write("ok    native handler preserves notification, tool context, native execution and question/artifact/sandbox controls\n");

  const handle = await open(handler, "r+");
  try {
    await handle.write(Buffer.from(permissionBefore), 0, permissionBefore.length, permissionOffset);
    run("--check", app);
    assert.throws(() => run("--check", "--require-patched", app), /permission hook.*required patch is missing/);
    run(app);
    await handle.write(Buffer.from("Y"), 0, 1, permissionOffset + 1);
    const corruptedHash = hash(await readFile(handler));
    assert.throws(() => run("--check", app), /permission hook.*unrecognized/);
    assert.throws(() => run(app), /permission hook.*unrecognized/);
    assert.equal(hash(await readFile(handler)), corruptedHash, "failed validation must not partially write patches");
    await handle.write(patched.subarray(permissionOffset, permissionOffset + permissionBefore.length),
      0, permissionBefore.length, permissionOffset);
  } finally {
    await handle.close();
  }
  await appendFile(handler, patched.subarray(permissionOffset, permissionOffset + permissionBefore.length));
  assert.throws(() => run("--check", app), /permission hook.*expected 1 site\(s\), found 2/);
  process.stdout.write("ok    strict handler validation rejects partial patches, changed sites and duplicate hooks without mutation\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
