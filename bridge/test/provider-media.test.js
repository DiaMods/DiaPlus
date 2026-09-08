import assert from "node:assert/strict";
import { access, readFile, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareMediaPayload, decodeMediaBase64, downloadMedia } from "../src/media-inputs.js";
import { runAppleHelper } from "../src/media-helper.js";
import { runCodexProvider } from "../src/providers/codex.js";
import { runAppleProvider } from "../src/providers/apple.js";
import { runOpenAICompatibleProvider } from "../src/providers/openai-compatible.js";
import { FinalTextStream, partialFinalText } from "../src/providers/decision-stream.js";
import { defaultConfig, validateConfig } from "../src/config.js";

const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } };
const pdf = { type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.7\nfixture").toString("base64") } };
const audio = { type: "audio", source: { type: "base64", media_type: "audio/wav", data: Buffer.from("RIFF fixture").toString("base64") } };
const user = (blocks) => ({ messages: [{ role: "user", content: blocks }] });
const nativeTools = [{ name: "read_tabs", input_schema: { type: "object", properties: {} } }];

test("media staging extracts nested tool images without exposing base64 or retaining files", async () => {
  const payload = user([{ type: "tool_result", tool_use_id: "call-1", content: [image] }, image]);
  const prepared = await prepareMediaPayload(payload, { target: "codex" });
  assert.equal(prepared.images.length, 2);
  assert.ok(!JSON.stringify(prepared.payload).includes("aGVsbG8="));
  assert.match(prepared.payload.messages[0].content[0].content[0].text, /attachment-1/);
  assert.equal((await stat(prepared.images[0].path)).mode & 0o777, 0o600);
  assert.equal(await readFile(prepared.images[0].path, "utf8"), "hello");
  assert.equal(payload.messages[0].content[1], image);
  await prepared.cleanup();
  for (const { path } of prepared.images) await assert.rejects(access(path), { code: "ENOENT" });
});

test("PDF/audio/video fallback routes through local extraction and cleans files on failure", async () => {
  let saved;
  const prepared = await prepareMediaPayload(user([pdf]), { target: "apple", helper: async (request) => {
    saved = request.path;
    assert.equal(request.action, "extract-media");
    assert.match(await readFile(request.path, "utf8"), /^%PDF/);
    return { content: [{ type: "text", text: "Page 1: readable text" }, image] };
  } });
  assert.match(prepared.payload.messages[0].content[1].text, /Page 1/);
  assert.equal(prepared.images.length, 1);
  await prepared.cleanup();
  await assert.rejects(access(saved), { code: "ENOENT" });
  for (const block of [audio, { type: "video", source: { type: "base64", media_type: "video/mp4", data: "aGVsbG8=" } }]) {
    await assert.rejects(prepareMediaPayload(user([block]), { target: "responses", helper: async (request) => {
      saved = request.path;
      throw new Error("Local speech assets unavailable");
    } }), /speech assets unavailable/);
    await assert.rejects(access(saved), { code: "ENOENT" });
  }
});

test("media rejects invalid sources, oversized data, and private download destinations", async () => {
  for (const data of ["", "YQ===", "YR==", "%%%%", "A", "a".repeat(28_000_000)]) {
    assert.throws(() => decodeMediaBase64(data), /base64|oversized/);
  }
  for (const url of ["file:///etc/passwd", "https://api.diabrowser.com/x", "http://127.0.0.1/x", "https://user:secret@example.com/x", "https://127.0.0.1/x"]) {
    await assert.rejects(downloadMedia(url), /protocol|refuses|HTTPS|credentials|private/);
  }
  await assert.rejects(prepareMediaPayload(user([{ type: "image", source: { type: "file", path: "/etc/passwd" } }]), { target: "codex" }), /requires base64/);
});

test("stream parser emits final text only and preserves split escapes and surrogate pairs", async () => {
  assert.equal(partialFinalText('{"kind":"tool_use","text":"hidden"'), "");
  assert.equal(partialFinalText('{"tool_calls":[{"text":"hidden"}]'), "");
  const encoded = JSON.stringify({ kind: "final", text: 'Hello\n"world" 😀', tool_calls: [] });
  const chunks = [];
  const stream = new FinalTextStream((text) => chunks.push(text));
  for (let index = 1; index <= encoded.length; index += 1) {
    const text = partialFinalText(encoded.slice(0, index));
    if (text) await stream.push(text);
  }
  assert.equal(chunks.join(""), 'Hello\n"world" 😀');
  assert.equal(partialFinalText('{"kind":"final","text":"x\\uD83D\\uDE'), "x");
  await assert.rejects(stream.push("different answer"), /revised final text/);
});

function mockCodex(events, inspect = () => {}) {
  return { startThread(options) {
    assert.equal(options.sandboxMode, "read-only");
    assert.equal(options.networkAccessEnabled, false);
    assert.equal(options.webSearchMode, "disabled");
    assert.equal(options.approvalPolicy, "never");
    return { async runStreamed(input, turn) {
      await inspect(input, turn);
      return { events: (async function* () { yield* events; })() };
    } };
  } };
}

test("Codex streams safe structured final text and sends SDK image inputs with cleanup", async () => {
  const deltas = [];
  let imagePath;
  const result = await runCodexProvider({
    payload: user([image]), tools: nativeTools, model: "fixture", onTextDelta: (text) => deltas.push(text),
    codexClient: mockCodex([
      { type: "item.updated", item: { type: "agent_message", id: "m", text: '{"kind":"final","text":"A red' } },
      { type: "item.completed", item: { type: "agent_message", id: "m", text: '{"kind":"final","text":"A red square.","tool_calls":[]}' } },
      { type: "turn.completed", usage: { input_tokens: 3, output_tokens: 2 } },
    ], async (input, turn) => {
      assert.equal(input[1].type, "local_image");
      imagePath = input[1].path;
      assert.equal(await readFile(imagePath, "utf8"), "hello");
      assert.ok(!input[0].text.includes("aGVsbG8="));
      assert.ok(turn.outputSchema);
    }),
  });
  assert.deepEqual(deltas, ["A red", " square."]);
  assert.equal(result.text, deltas.join(""));
  await assert.rejects(access(imagePath), { code: "ENOENT" });
});

test("Codex rejects built-in actions, premature stream end and malformed tool decisions", async () => {
  for (const [events, pattern] of [
    [[{ type: "item.started", item: { type: "command_execution" } }], /disabled built-in action/],
    [[{ type: "item.completed", item: { id: "m", type: "agent_message", text: "Incomplete" } }], /before turn completion/],
    [[{ type: "item.completed", item: { id: "m", type: "agent_message", text: '{"kind":"tool_use","text":"","tool_calls":[]}' } }, { type: "turn.completed" }], /no valid tool calls/],
  ]) {
    await assert.rejects(runCodexProvider({ payload: user([]), tools: nativeTools, model: "fixture", codexClient: mockCodex(events) }), pattern);
  }
});

test("Apple streams unordered valid snapshots without exposing a tool decision or image bytes", async () => {
  const chunks = [];
  let stagedPath;
  const result = await runAppleProvider({ provider: { mode: "on-device", imageMode: "native" }, payload: user([image]), tools: nativeTools, model: "fixture", onTextDelta: (text) => chunks.push(text),
    helper: async (request, { onEvent }) => {
      assert.equal(request.stream, true);
      stagedPath = request.images[0].path;
      assert.ok(!request.prompt.includes("aGVsbG8="));
      await onEvent({ type: "decision_snapshot", json: '{"text":"The image","kind":"final"}' });
      await onEvent({ type: "decision_snapshot", json: '{"kind":"final","text":"The image is red."}' });
      return { kind: "final", text: "The image is red.", tool_calls: [], usage: {} };
    },
  });
  assert.deepEqual(chunks, ["The image", " is red."]);
  assert.equal(result.text, chunks.join(""));
  await assert.rejects(access(stagedPath), { code: "ENOENT" });
  const toolChunks = [];
  await runAppleProvider({ provider: { mode: "on-device" }, payload: user([]), tools: nativeTools, model: "fixture", onTextDelta: (text) => toolChunks.push(text),
    helper: async (_request, { onEvent }) => {
      const decision = { kind: "tool_use", text: "Do not display", tool_calls: [{ name: "read_tabs", arguments_json: "{}" }] };
      await onEvent({ type: "decision_snapshot", json: JSON.stringify(decision) });
      return decision;
    },
  });
  assert.deepEqual(toolChunks, []);
});

test("Apple defaults to labeled local Vision observations and preserves explicit native-image configuration", async () => {
  const configured = defaultConfig();
  const apple = configured.providers.find((provider) => provider.id === "apple-on-device");
  delete apple.imageMode;
  assert.equal(validateConfig(configured).providers.find((provider) => provider.id === apple.id).imageMode, "vision");
  apple.imageMode = "native";
  assert.equal(validateConfig(configured).providers.find((provider) => provider.id === apple.id).imageMode, "native");
  apple.imageMode = "invalid";
  assert.throws(() => validateConfig(configured), /imageMode/);
  const actions = [];
  const result = await runAppleProvider({ provider: { mode: "on-device" }, payload: user([image]), tools: [], model: "fixture",
    helper: async (request) => {
      actions.push(request.action);
      if (request.action === "extract-media") return { content: [{ type: "text", text: "Local Vision/OCR observations only: recognized text SAMPLE" }] };
      assert.match(request.prompt, /Local Vision\/OCR observations only/);
      assert.deepEqual(request.images, []);
      return { text: "SAMPLE" };
    },
  });
  assert.equal(result.text, "SAMPLE");
  assert.deepEqual(actions, ["extract-media", "generate"]);
});

for (const api of ["chat-completions", "responses"]) {
  test(`${api} sends actual PDF channel including nested tool attachments`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const messages = body.messages ?? body.input;
      const parts = messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
      const files = parts.filter((part) => ["input_file", "file"].includes(part.type));
      assert.equal(files.length, 1);
      const file = files[0].file ?? files[0];
      assert.equal(file.filename, "report.pdf");
      assert.equal(file.file_data, `data:application/pdf;base64,${pdf.source.data}`);
      const toolOutput = messages.find((message) => message.role === "tool" || message.type === "function_call_output");
      assert.ok(!JSON.stringify(toolOutput).includes(pdf.source.data));
      return new Response('data: [DONE]\n\n');
    };
    try {
      await runOpenAICompatibleProvider({ provider: { api, baseURL: "https://example.com/v1" }, payload: user([{ type: "tool_result", tool_use_id: "call", content: [pdf] }]), tools: [], model: "fixture" });
    } finally { globalThis.fetch = original; }
  });
}

test("Chat Completions sends WAV through input_audio", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const part = JSON.parse(options.body).messages[0].content[0];
    assert.deepEqual(part, { type: "input_audio", input_audio: { format: "wav", data: audio.source.data } });
    return new Response("data: [DONE]\n\n");
  };
  try {
    await runOpenAICompatibleProvider({ provider: { api: "chat-completions", baseURL: "https://example.com/v1" }, payload: user([audio]), tools: [], model: "fixture" });
  } finally { globalThis.fetch = original; }
});

test("helper JSON-lines callbacks arrive before process completion, with bounded failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dia-helper-test-"));
  const path = join(directory, "helper");
  await writeFile(path, `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on('end',()=>{console.log(JSON.stringify({type:'text_snapshot',text:'partial'}));setTimeout(()=>console.log(JSON.stringify({type:'result',value:{text:'partial answer'}})),75)});\n`, { mode: 0o700 });
  try {
    const order = [];
    const result = await runAppleHelper({}, { helperPath: path, onEvent: (event) => order.push(event.type) });
    assert.deepEqual(order, ["text_snapshot", "result"]);
    assert.equal(result.text, "partial answer");
    await assert.rejects(runAppleHelper({}, { helperPath: path, timeoutMs: 10 }), /timed out/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
