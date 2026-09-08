import assert from "node:assert/strict";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { runAppleHelper } from "../src/media-helper.js";
import { runAppleProvider } from "../src/providers/apple.js";

const directory = dirname(fileURLToPath(import.meta.url));
const helperPath = resolve(directory, "../../.build/apple-model-helper/DiaCustomAppleModel");
const invoke = (request, onEvent) => runAppleHelper(request, { helperPath, onEvent });
async function built(context) {
  try { await access(helperPath); return true; }
  catch { context.skip("Apple helper has not been built"); return false; }
}

function pdfFixture() {
  const text = "BT /F1 20 Tf 20 100 Td (MEDIA FIXTURE) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}

function redPNG() {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(80, 0); header.writeUInt32BE(80, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(80 * (80 * 3 + 1));
  for (let row = 0; row < 80; row += 1) for (let column = 0; column < 80; column += 1) pixels[row * 241 + column * 3 + 1] = 255;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

test("real local PDF extraction returns page text and rendered images", async (context) => {
  if (!await built(context)) return;
  const temporary = await mkdtemp(join(tmpdir(), "dia-pdf-fixture-"));
  const path = join(temporary, "fixture.pdf");
  try {
    await writeFile(path, pdfFixture(), { mode: 0o600 });
    const result = await invoke({ action: "extract-media", path, mediaType: "application/pdf" });
    assert.match(result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), /MEDIA FIXTURE/);
    const image = result.content.find((part) => part.type === "image");
    assert.equal(image.source.media_type, "image/jpeg");
    assert.equal(Buffer.from(image.source.data, "base64").readUInt16BE(0), 0xffd8);
    const imagePath = join(temporary, "page.jpg");
    await writeFile(imagePath, Buffer.from(image.source.data, "base64"));
    const observations = await invoke({ action: "extract-media", path: imagePath, mediaType: "image/jpeg" });
    assert.match(observations.content[0].text, /Local Vision\/OCR observations only/);
    assert.match(observations.content[0].text, /MEDIA FIXTURE/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("real video extraction labels frame sampling and missing audio accurately", async (context) => {
  if (!await built(context)) return;
  const result = await invoke({ action: "extract-media", path: join(directory, "fixtures/red-square.mp4"), mediaType: "video/mp4" });
  const texts = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.match(texts, /frames sampled evenly/);
  assert.match(texts, /Video frame at/);
  assert.match(texts, /no audio track/);
  assert.equal(result.content.filter((part) => part.type === "image").length, 1);
});

test("real recorded-audio transcription uses installed on-device speech assets", async (context) => {
  if (!await built(context)) return;
  const status = await invoke({ action: "status" });
  if (!status.media.speech?.available) {
    context.skip(`Local speech assets are ${status.media.speech?.state ?? "unavailable"}; tests do not download them`);
    return;
  }
  const result = await invoke({ action: "extract-media", path: join(directory, "fixtures/media-phrase.wav"), mediaType: "audio/wav" });
  const text = result.content.map((part) => part.text).join("\n");
  assert.match(text, /On-device speech transcript/);
  assert.match(text, /media fixture test/i);
});

test("Apple native image generation uses real Attachment inputs and incremental text", async (context) => {
  if (!await built(context)) return;
  const status = await invoke({ action: "status" });
  if (!status.onDevice.available) { context.skip(status.onDevice.reason); return; }
  assert.equal(status.media.nativeImages, true);
  const temporary = await mkdtemp(join(tmpdir(), "dia-image-fixture-"));
  const path = join(temporary, "red.png");
  try {
    await writeFile(path, redPNG(), { mode: 0o600 });
    const snapshots = [];
    let result;
    try {
      result = await invoke({ action: "generate", mode: "on-device", structured: false, stream: true,
        prompt: "What single color fills the attached image? Answer with just the color name.",
        images: [{ path, label: "attachment-1" }], maximumResponseTokens: 64,
      }, (event) => { if (event.type === "text_snapshot") snapshots.push(event.text); });
    } catch (error) {
      // macOS 27 beta can refuse even a synthetic red square before generation.
      // Keep the actual native failure visible; default Vision/OCR is tested below.
      if (/model's safety guardrails were triggered/i.test(error.message)) {
        context.skip(`Installed Apple vision runtime declined the safe fixture: ${error.message}`);
        return;
      }
      throw error;
    }
    assert.match(result.text.toLowerCase(), /red/);
    assert.equal(snapshots.at(-1), result.text);
    assert.equal(typeof result.usage.total_tokens, "number");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("default Apple image path analyzes local Vision observations through the real model", async (context) => {
  if (!await built(context)) return;
  const status = await invoke({ action: "status" });
  if (!status.onDevice.available) { context.skip(status.onDevice.reason); return; }
  const chunks = [];
  const result = await runAppleProvider({
    provider: { mode: "on-device" }, model: "default", tools: [],
    payload: { max_tokens: 64, messages: [{ role: "user", content: [
      { type: "text", text: "What color fills this image? Answer with just the color name based on the supplied observations." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: redPNG().toString("base64") } },
    ] }] },
    onTextDelta: (text) => chunks.push(text),
    helper: (request, options) => runAppleHelper(request, { ...options, helperPath }),
  });
  assert.match(result.text.toLowerCase(), /red/);
  assert.equal(chunks.join(""), result.text);
});
