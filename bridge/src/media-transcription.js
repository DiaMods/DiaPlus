import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAppleHelper } from "./media-helper.js";
import { isAllowedLoopbackHostHeader } from "./network-policy.js";

const maximumAudioBytes = 20 * 1024 * 1024;
let activeTranscriptions = 0;

// Dia 86584's SpeechRecognizer sends raw audio/m4a bytes. Its streaming decoder
// registers a named text_response SSE event with {delta:String}; HTTP EOF is the
// completion signal. The legacy decoder accepts {text:String}.
export async function handleMediaTranscription(request, response, requestURL, {
  readBody,
  jsonResponse,
  transcribe = transcribeAudioBytes,
} = {}) {
  if (requestURL.pathname !== "/ai-service-local-v1/audio-transcription") return false;
  const json = jsonResponse ?? ((response, status, value) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  });
  if (!isAllowedLoopbackHostHeader(request.headers.host, Number(requestURL.port || 80))) {
    json(response, 421, { error: "loopback_host_required" });
    return true;
  }
  if (request.method !== "POST") { json(response, 405, { error: "method_not_allowed" }); return true; }
  // Native URLSession has no browser Origin. Browser callers must have exactly
  // the local origin; no remote webpage can submit recordings to this endpoint.
  const origin = request.headers.origin;
  const localOrigin = `http://${request.headers.host}`;
  if ((origin !== undefined && origin !== localOrigin) || request.headers["sec-fetch-site"] === "cross-site") {
    json(response, 403, { error: "local_origin_required" });
    return true;
  }
  if (!/^audio\/(m4a|mp4|x-m4a|wav|x-wav|mpeg|mp3|flac)(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
    json(response, 415, { error: "Dictation requires raw WAV, M4A, MP3 or FLAC audio" });
    return true;
  }
  if (Number(request.headers["content-length"] ?? 0) > maximumAudioBytes) {
    json(response, 413, { error: "Dictation audio exceeds the 20 MiB limit" });
    return true;
  }
  if (activeTranscriptions >= 2) { json(response, 429, { error: "Local dictation is busy; try again shortly" }); return true; }
  activeTranscriptions += 1;
  const cancelled = new AbortController();
  const onClose = () => { if (!response.writableEnded) cancelled.abort(new Error("Dictation client disconnected")); };
  response.once("close", onClose);
  const signal = AbortSignal.any([cancelled.signal, AbortSignal.timeout(28_000)]);
  const stopUpload = () => { if (request.complete === false) request.destroy(signal.reason); };
  signal.addEventListener("abort", stopUpload, { once: true });
  const streaming = requestURL.searchParams.get("stream") === "1";
  let streamedText = "";
  const sendDelta = async (delta) => {
    signal.throwIfAborted();
    if (!delta) return;
    if (!response.headersSent) response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no",
    });
    streamedText += delta;
    response.write(`event: text_response\ndata: ${JSON.stringify({ delta })}\n\n`);
  };
  try {
    // The normal server reader also has a global ceiling. Check the smaller
    // dictation ceiling incrementally here so chunked uploads are bounded too.
    let body;
    if (typeof request[Symbol.asyncIterator] === "function") {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        signal.throwIfAborted();
        size += chunk.length;
        if (size > maximumAudioBytes) throw new Error("Dictation audio exceeds the 20 MiB limit");
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    } else body = await readBody(request);
    if (body.length > maximumAudioBytes) throw new Error("Dictation audio exceeds the 20 MiB limit");
    const result = await transcribe(body, { signal, onTextDelta: streaming ? sendDelta : undefined });
    signal.throwIfAborted();
    if (streaming) {
      if (!result.text.startsWith(streamedText)) throw new Error("Local speech revised an already finalized transcript");
      await sendDelta(result.text.slice(streamedText.length));
      if (!response.headersSent) response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      response.end();
    } else json(response, 200, { text: result.text });
  } catch (error) {
    if (!response.headersSent && !response.destroyed) {
      json(response, /20 MiB/.test(error.message) ? 413 : 400, { error: error.message });
    } else if (!response.writableEnded) {
      // A failed partial transcript must not be mistaken for successful EOF.
      response.destroy();
    }
  } finally {
    activeTranscriptions -= 1;
    signal.removeEventListener("abort", stopUpload);
    response.removeListener("close", onClose);
  }
  return true;
}

export function audioMediaType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) throw new Error("Dictation audio is empty or malformed");
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE") return "audio/wav";
  if (bytes.subarray(4, 8).toString() === "ftyp") return "audio/mp4";
  if (bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (bytes.subarray(0, 4).toString() === "fLaC") return "audio/flac";
  throw new Error("Dictation accepts WAV, M4A, MP3 or FLAC audio");
}

export async function transcribeAudioBytes(bytes, { helper = runAppleHelper, onTextDelta, signal } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximumAudioBytes) throw new Error("Dictation audio exceeds the 20 MiB limit");
  const mediaType = audioMediaType(bytes);
  const directory = await mkdtemp(join(tmpdir(), "dia-custom-dictation-"));
  const path = join(directory, `audio.${{ "audio/wav": "wav", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/flac": "flac" }[mediaType]}`);
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    const value = await helper({ action: "transcribe-audio", path, mediaType, stream: Boolean(onTextDelta) }, {
      signal,
      onEvent: async (event) => {
        if (event.type === "transcription_delta" && typeof event.text === "string" && onTextDelta) await onTextDelta(event.text);
      },
    });
    if (typeof value?.text !== "string") throw new Error("Local speech helper returned no transcript");
    return { text: value.text };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
