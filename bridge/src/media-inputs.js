import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAllowedConnectorURL } from "./network-policy.js";
import { isPrivateAddress } from "./local-tools/web.js";
import { runAppleHelper } from "./media-helper.js";

const maximumBytes = 20 * 1024 * 1024;
const maximumTotalBytes = 40 * 1024 * 1024;
const mediaTypes = new Set(["image", "document", "audio", "video"]);
const extensions = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3",
  "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
  "audio/flac": "flac", "audio/ogg": "ogg", "audio/webm": "webm",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

export function decodeMediaBase64(data) {
  if (typeof data !== "string" || !data.length || data.length > Math.ceil(maximumBytes / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 === 1) {
    throw new Error("Invalid or oversized base64 media attachment (maximum 20 MiB)");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) {
    throw new Error("Invalid base64 media attachment");
  }
  return bytes;
}

export function attachmentURL(rawURL) {
  const url = assertAllowedConnectorURL(rawURL);
  if (url.protocol !== "https:") throw new Error("Media attachment URLs must use HTTPS");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      (isIP(hostname) && isPrivateAddress(hostname))) {
    throw new Error("Media attachment URLs cannot refer to private or reserved addresses");
  }
  return url;
}

// Pin a validated public DNS answer to this connection; do not forward cookies,
// credentials, redirects, or let a second DNS lookup reach a private address.
export async function downloadMedia(rawURL) {
  const url = attachmentURL(rawURL);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Media attachments cannot be fetched from private or reserved addresses");
  }
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      headers: { accept: "image/*,application/pdf,audio/*,video/*", "user-agent": "DiaCustom/1.0" },
      lookup: (_hostname, options, done) => options.all
        ? done(null, [address]) : done(null, address.address, address.family),
    }, async (response) => {
      try {
        if (response.statusCode !== 200) throw new Error(`Media download HTTP ${response.statusCode}; redirects are not followed`);
        if (Number(response.headers["content-length"] ?? 0) > maximumBytes) throw new Error("Media attachment exceeds 20 MiB");
        let length = 0;
        const chunks = [];
        for await (const chunk of response) {
          length += chunk.length;
          if (length > maximumBytes) throw new Error("Media attachment exceeds 20 MiB");
          chunks.push(chunk);
        }
        resolve({ bytes: Buffer.concat(chunks), mediaType: String(response.headers["content-type"] ?? "").split(";")[0].toLowerCase() });
      } catch (error) { response.destroy(); reject(error); }
    });
    const deadline = setTimeout(() => req.destroy(new Error("Media download timed out")), 30_000);
    deadline.unref();
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end();
  });
}

export function imageSourceURL(block) {
  const source = block?.source;
  if (source?.type === "base64" && /^image\/(png|jpeg|webp|gif)$/.test(source.media_type ?? "")) {
    decodeMediaBase64(source.data);
    return `data:${source.media_type};base64,${source.data}`;
  }
  if (source?.type === "url") return attachmentURL(source.url).toString();
  throw new Error("The image attachment needs a supported base64 image or an HTTPS image URL");
}

// Convert only media in content blocks, including tool results. Never interpret
// arbitrary strings or file paths as permission to read the local filesystem.
export async function prepareMediaPayload(payload, {
  target, helper = runAppleHelper, download = downloadMedia,
} = {}) {
  let directory;
  let totalBytes = 0;
  let sequence = 0;
  const images = [];
  const cleanup = async () => { if (directory) await rm(directory, { recursive: true, force: true }); };
  async function stage(bytes, mediaType) {
    totalBytes += bytes.length;
    if (totalBytes > maximumTotalBytes) throw new Error("Media attachments exceed the 40 MiB request limit");
    directory ??= await mkdtemp(join(tmpdir(), "dia-custom-media-"));
    const path = join(directory, `${++sequence}.${extensions[mediaType] ?? "bin"}`);
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    return path;
  }
  async function bytesFor(block) {
    const source = block.source;
    if (source?.type === "base64") return { bytes: decodeMediaBase64(source.data), mediaType: source.media_type };
    if (source?.type === "url") {
      attachmentURL(source.url);
      const value = await download(source.url);
      if (value.bytes.length > maximumBytes) throw new Error("Media attachment exceeds 20 MiB");
      return { ...value, mediaType: source.media_type ?? value.mediaType };
    }
    throw new Error(`The ${block.type} attachment requires base64 data or a public HTTPS URL`);
  }
  async function convert(block) {
    if (block?.type === "tool_result" && Array.isArray(block.content)) {
      return [{ ...block, content: await convertBlocks(block.content) }];
    }
    if (!mediaTypes.has(block?.type)) return [block];
    if (block.type === "document" && block.source?.type === "text") {
      return [{ type: "text", text: [block.title, block.source.data].filter(Boolean).join("\n\n") }];
    }
    if (block.type === "image" && ["chat", "responses"].includes(target)) {
      imageSourceURL(block);
      if (block.source.type === "base64") {
        totalBytes += decodeMediaBase64(block.source.data).length;
        if (totalBytes > maximumTotalBytes) throw new Error("Media attachments exceed the 40 MiB request limit");
      }
      return [block];
    }
    const { bytes, mediaType } = await bytesFor(block);
    if (!extensions[mediaType] ||
        (block.type === "image" && !mediaType.startsWith("image/")) ||
        (block.type === "document" && mediaType !== "application/pdf") ||
        (block.type === "audio" && !mediaType.startsWith("audio/")) ||
        (block.type === "video" && !mediaType.startsWith("video/"))) {
      throw new Error(`Cannot translate ${block.type} attachment type ${mediaType ?? "unknown"}; provide PDF, supported images, audio or video`);
    }
    if (block.type === "document" && bytes.subarray(0, 5).toString() !== "%PDF-") {
      throw new Error("Cannot translate invalid PDF attachment: missing PDF header");
    }
    if ((block.type === "document" && ["chat", "responses"].includes(target)) ||
        (block.type === "audio" && target === "chat" && ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"].includes(mediaType))) {
      totalBytes += bytes.length;
      if (totalBytes > maximumTotalBytes) throw new Error("Media attachments exceed the 40 MiB request limit");
      return [{ ...block, source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } }];
    }
    const path = await stage(bytes, mediaType);
    if (block.type === "image") {
      if (target === "apple-vision") {
        const extracted = await helper({ action: "extract-media", mediaType, path });
        if (!Array.isArray(extracted?.content) || !extracted.content.length) throw new Error("Local Vision extraction returned no content");
        return convertBlocks(extracted.content);
      }
      if (images.length >= 32) throw new Error("At most 32 images can be analyzed in one request");
      const label = `attachment-${images.length + 1}`;
      images.push({ path, label });
      return [{ type: "text", text: `[Image ${label} is supplied separately with this request.]` }];
    }
    const extracted = await helper({ action: "extract-media", mediaType, path });
    if (!Array.isArray(extracted?.content) || !extracted.content.length) throw new Error("Local media extraction returned no content");
    const converted = await convertBlocks(extracted.content);
    return [...(block.title ? [{ type: "text", text: String(block.title) }] : []), ...converted];
  }
  async function convertBlocks(blocks) {
    const converted = [];
    for (const block of blocks) converted.push(...await convert(block));
    return converted;
  }
  try {
    const messages = [];
    for (const message of payload?.messages ?? []) {
      messages.push({ ...message, content: Array.isArray(message.content) ? await convertBlocks(message.content) : message.content });
    }
    return { payload: { ...payload, messages }, images, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
