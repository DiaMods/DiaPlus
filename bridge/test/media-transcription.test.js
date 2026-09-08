import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import test from "node:test";
import { audioMediaType, transcribeAudioBytes, handleMediaTranscription } from "../src/media-transcription.js";
import { runAppleHelper } from "../src/media-helper.js";

const wavPath = fileURLToPath(new URL("./fixtures/media-phrase.wav", import.meta.url));
const helperPath = fileURLToPath(new URL("../../.build/apple-model-helper/DiaCustomAppleModel", import.meta.url));

test("native audio accepts real file signatures rather than trusting upload MIME", async () => {
  assert.equal(audioMediaType(await readFile(wavPath)), "audio/wav");
  assert.equal(audioMediaType(Buffer.from("\0\0\0\x20ftypM4A fixture")), "audio/mp4");
  assert.throws(() => audioMediaType(Buffer.from("not actual audio data")), /accepts WAV/);
  assert.throws(() => audioMediaType(Buffer.alloc(0)), /empty or malformed/);
});

test("native transcription preserves finalized deltas and removes private audio on failure", async () => {
  const bytes = await readFile(wavPath);
  let staged;
  const chunks = [];
  const result = await transcribeAudioBytes(bytes, {
    onTextDelta: (text) => chunks.push(text),
    helper: async (request, options) => {
      staged = request.path;
      assert.equal(request.action, "transcribe-audio");
      assert.equal(request.mediaType, "audio/wav");
      assert.deepEqual(await readFile(staged), bytes);
      await options.onEvent({ type: "transcription_delta", text: "Media " });
      await options.onEvent({ type: "transcription_delta", text: "fixture." });
      return { text: "Media fixture." };
    },
  });
  assert.deepEqual(result, { text: chunks.join("") });
  await assert.rejects(access(staged), { code: "ENOENT" });
  await assert.rejects(transcribeAudioBytes(bytes, { helper: async (request) => {
    staged = request.path;
    throw new Error("Assets unavailable");
  } }), /Assets unavailable/);
  await assert.rejects(access(staged), { code: "ENOENT" });
});

test("native WAV dictation returns exact local transcript and real helper deltas", async (context) => {
  try { await access(helperPath); } catch { context.skip("Apple helper has not been built"); return; }
  const helper = (request, options) => runAppleHelper(request, { ...options, helperPath });
  const status = await helper({ action: "status" });
  if (!status.media.speech.available) { context.skip("Prepare local speech before live dictation tests"); return; }
  const chunks = [];
  const result = await transcribeAudioBytes(await readFile(wavPath), { helper, onTextDelta: (text) => chunks.push(text) });
  assert.match(result.text, /media fixture test/i);
  assert.equal(result.text, chunks.join(""));
});

test("native HTTP dictation matches Dia's named SSE event, raw body and legacy JSON contract", async () => {
  const bytes = await readFile(wavPath);
  const server = createServer((request, response) => {
    handleMediaTranscription(request, response, new URL(request.url, `http://${request.headers.host}`), {
      transcribe: async (body, { onTextDelta, signal }) => {
        assert.deepEqual(body, bytes);
        assert.equal(signal.aborted, false);
        if (onTextDelta) { await onTextDelta("Media "); await onTextDelta("fixture"); }
        return { text: "Media fixture test." };
      },
    }).catch((error) => { response.writeHead(500); response.end(error.message); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/ai-service-local-v1/audio-transcription`;
  try {
    const stream = await fetch(`${base}?stream=1`, { method: "POST", headers: { "content-type": "audio/m4a" }, body: bytes });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    assert.equal(await stream.text(), 'event: text_response\ndata: {"delta":"Media "}\n\nevent: text_response\ndata: {"delta":"fixture"}\n\nevent: text_response\ndata: {"delta":" test."}\n\n');
    const legacy = await fetch(base, { method: "POST", headers: { "content-type": "audio/wav" }, body: bytes });
    assert.deepEqual(await legacy.json(), { text: "Media fixture test." });
    const foreign = await fetch(base, { method: "POST", headers: { "content-type": "audio/wav", origin: "https://example.com" }, body: bytes });
    assert.equal(foreign.status, 403);
    const wrongType = await fetch(base, { method: "POST", headers: { "content-type": "text/plain" }, body: bytes });
    assert.equal(wrongType.status, 415);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

function mockResponse() {
  const response = new EventEmitter();
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers; response.headersSent = true; };
  response.write = (value) => { response.body = (response.body ?? "") + value; };
  response.end = (value = "") => { response.write(value); response.writableEnded = true; };
  response.destroy = () => { response.destroyed = true; response.emit("close"); };
  return response;
}

test("native dictation rejects oversized/foreign-host requests before reading and cancels disconnected work", async () => {
  const url = new URL("http://127.0.0.1:8765/ai-service-local-v1/audio-transcription?stream=1");
  const headers = { host: "127.0.0.1:8765", "content-type": "audio/m4a" };
  for (const [extra, status] of [[{ "content-length": String(21 * 1024 * 1024) }, 413], [{ host: "evil.example:8765" }, 421]]) {
    const response = mockResponse();
    await handleMediaTranscription({ method: "POST", headers: { ...headers, ...extra } }, response, url, {
      readBody: () => assert.fail("Rejected requests must not be read"),
      transcribe: () => assert.fail("Rejected requests must not be transcribed"),
    });
    assert.equal(response.status, status);
  }
  const response = mockResponse();
  let aborted = false;
  await handleMediaTranscription({ method: "POST", headers }, response, url, {
    readBody: () => readFile(wavPath),
    transcribe: async (_bytes, { signal }) => {
      const failed = new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }));
      response.destroy();
      return failed;
    },
  });
  assert.equal(aborted, true);
});
