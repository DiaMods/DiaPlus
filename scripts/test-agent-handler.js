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

  const dia150 = original.includes('X.onCheck("permission", { tool: N, tool_use_id: I, ...M && { namespace: M }, input: P }, H(R)).catch(() => null)');
  const dia151 = original.includes('t.onCheck("permission", { tool: b, tool_use_id: v, ...y && { namespace: y }, input: A }, l(R)).catch(() => null)');
  const dia153 = original.includes('t.onCheck("permission", { tool: b, tool_use_id: A, ...I && { namespace: I }, input: g }, u(P)).catch(() => null)');
  const dia154 = original.includes('t.onCheck("permission", { tool: b, tool_use_id: w, ...I && { namespace: I }, input: C }, d(N)).catch(() => null)');
  const dia155 = original.includes('t.onCheck("permission", { tool: I, tool_use_id: O, ...N && { namespace: N }, input: P }, p(w)).catch(() => null)');
  const richResults = dia153 || dia154 || dia155;
  const permissionBefore = dia155
    ? 't.onCheck("permission", { tool: I, tool_use_id: O, ...N && { namespace: N }, input: P }, p(w)).catch(() => null)'
    : dia154
    ? 't.onCheck("permission", { tool: b, tool_use_id: w, ...I && { namespace: I }, input: C }, d(N)).catch(() => null)'
    : dia153
    ? 't.onCheck("permission", { tool: b, tool_use_id: A, ...I && { namespace: I }, input: g }, u(P)).catch(() => null)'
    : dia151
    ? 't.onCheck("permission", { tool: b, tool_use_id: v, ...y && { namespace: y }, input: A }, l(R)).catch(() => null)'
    : dia150
    ? 'X.onCheck("permission", { tool: N, tool_use_id: I, ...M && { namespace: M }, input: P }, H(R)).catch(() => null)'
    : 'X.onCheck("permission", { tool: N, tool_use_id: I, ...M && { namespace: M }, input: P }, K(R)).catch(() => null)';
  const permissionOffset = original.indexOf(permissionBefore);
  assert.ok(permissionOffset >= 0, "native permission fixture must be recognized");
  const permissionExpression = patched.subarray(permissionOffset, permissionOffset + permissionBefore.length).toString().trim();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const permission = new AsyncFunction(...(dia155 ? ["t", "I", "O", "N", "P", "p", "w"] : dia154 ? ["t", "b", "w", "I", "C", "d", "N"]
    : dia153 ? ["t", "b", "A", "I", "g", "u", "P"]
    : dia151 ? ["t", "b", "v", "y", "A", "l", "R"]
    : ["X", "N", "I", "M", "P", dia150 ? "H" : "K", "R"]), `return await ${permissionExpression};`);
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

  const callbackOffset = original.indexOf(dia155 ? "async (ae, ve) => {" : dia154 ? "async (le, ie) => {" : dia153 ? "async (ye, oe) => {" : dia151 ? "async (ae, H) => {" : dia150 ? "async (J$, h) => {" : "async (l, C$) => {");
  const callbackEnd = original.indexOf(dia155 ? "}, BUt(I," : dia154 ? "}, LUt(I," : dia153 ? "}, hwt(P," : dia151 ? "}, g2t(w," : dia150 ? "}, cd4(T," : "}, Wx6(b,", callbackOffset) + 1;
  assert.ok(callbackOffset >= 0 && callbackEnd > callbackOffset);
  const callbackExpression = patched.subarray(callbackOffset, callbackEnd).toString().trim();
  for (const [namespace, tool, local] of [
    ["dia", "search_web", true], ["dia", "fetch_web_content", true],
    ["dia", "read_tabs", false], ["dia", "open_tabs", false],
    ["custom", "search_web", false], ["dia", "search_web_extra", false],
    ...(richResults ? [["dia", "browser_use", false], ["custom", "browser_use", false]] : []),
  ]) {
    const nativeCalls = [], fetchCalls = [], registrations = [], contextIDs = [];
    const onTool = { onTool: async (...args) => { nativeCalls.push(args); return "native-result"; } };
    const fetch = async (...args) => { fetchCalls.push(args); return { ok: true, text: async () => "local-result" }; };
    const richContent = [{ type: "image", data: "fixture", mimeType: "image/png" }];
    const callback = (dia154 || dia155)
      ? new Function("g", dia155 ? "V" : "W", dia155 ? "GUt" : "DUt", "t", "I", "s", "y", "r", dia155 ? "yee" : "See", dia155 ? "$Ut" : "MUt", "fetch", `return (${callbackExpression});`)(
        new Set(), tool, (...args) => registrations.push(args), "emitter", "definition",
        id => { contextIDs.push(id); return { nativeContext: "context-1" }; }, namespace, onTool, () => richContent,
        error => ({ content: [{ type: "text", text: JSON.stringify({ error }) }] }), fetch)
      : dia153
      ? new Function("E", "X", "mwt", "t", "P", "s", "R", "r", "D5", "_wt", "fetch", `return (${callbackExpression});`)(
        new Set(), tool, (...args) => registrations.push(args), "emitter", "definition",
        () => ({ nativeContext: "context-1" }), namespace, onTool, () => richContent,
        error => ({ content: [{ type: "text", text: JSON.stringify({ error }) }] }), fetch)
      : dia151
      ? new Function("g", "X", "E2t", "t", "w", "i", "A", "r", "_2t", "fetch", `return (${callbackExpression});`)(
        new Set(), tool, (...args) => registrations.push(args), "emitter", "definition",
        () => ({ nativeContext: "context-1" }), namespace, onTool,
        error => ({ content: [{ type: "text", text: JSON.stringify({ error }) }] }), fetch)
      : dia150
      ? new Function("w", "s", "ld4", "X", "T", "z", "P", "Z", "dd4", "fetch", `return (${callbackExpression});`)(
        new Set(), tool, (...args) => registrations.push(args), "emitter", "definition",
        () => ({ nativeContext: "context-1" }), namespace, onTool,
        error => ({ content: [{ type: "text", text: JSON.stringify({ error }) }] }), fetch)
      : new Function("j", "d", "Gx6", "X", "b", "W", "I", "Q", "fetch", `return (${callbackExpression});`)(
        new Set(), tool, (...args) => registrations.push(args), "emitter", "definition",
        () => ({ nativeContext: "context-1" }), namespace, onTool, fetch);
    const input = { query: "fixture" };
    const result = await callback(input, { _meta: { "claudecode/toolUseId": "tool-2" } });
    assert.deepEqual(result, { content: richResults && namespace === "dia" && tool === "browser_use"
      ? richContent : [{ type: "text", text: local ? "local-result" : "native-result" }] });
    assert.deepEqual(nativeCalls, [[tool, input, namespace, { nativeContext: "context-1", toolUseId: "tool-2" }]]);
    assert.equal(registrations.length, 1);
    assert.equal(fetchCalls.length, local ? 1 : 0);
    if (local) {
      assert.equal(fetchCalls[0][0], "http://127.0.0.1:8765/t");
      assert.deepEqual(JSON.parse(fetchCalls[0][1].body), { n: tool, i: input });
    }
    if (dia154 || dia155) {
      assert.deepEqual(contextIDs, ["tool-2"], "the native context factory must receive the validated tool-use ID");
      await callback(input, { _meta: { "claudecode/toolUseId": 42 } });
      assert.deepEqual(contextIDs, ["tool-2", undefined], "invalid tool-use IDs must not reach native context lookup");
      assert.deepEqual(nativeCalls.at(-1)[3], { nativeContext: "context-1" });
    }
  }

  for (const boundary of (dia150 || dia151 || richResults ? [
    '.onCheck("user_question",',
    'permissionMode: "default"',
    'CLAUDE_CODE_SANDBOX_PROFILE || (() => {',
    'file:// URLs are not allowed in open_tabs',
  ] : [
    'X.onCheck("user_question", { input: L }, K(W()))',
    'permissionMode: "default", canUseTool: u8.canUseTool',
    'CLAUDE_CODE_SANDBOX_PROFILE || (() => {',
    'let u = Vm$(SC4(G, "artifacts")) + yC4;\n  function e(d) {\n    return Vm$(d).startsWith(u);\n  }',
  ])) {
    assert.ok(original.includes(boundary), "native boundary exists in the official fixture");
    assert.ok(patched.includes(boundary), "native boundary must remain intact");
  }
  for (const name of dia155 ? ["IIr", "Dee", "Uee", "Fee"] : dia154 ? ["AIr", "Nee", "Mee", "kee"] : dia153 ? ["nyr", "V5", "Y5"] : dia151 ? ["XDr", "Ace", "_ce"] : dia150 ? [] : ["bC4", "bJ$", "CJ$"]) {
    const start = original.indexOf(`function ${name}(`);
    const end = Math.min(...[original.indexOf("\nfunction ", start + 1), original.indexOf("\nasync function ", start + 1)].filter(offset => offset >= 0));
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
