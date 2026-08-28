import { createServer } from "node:http";
import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  authorizeNativeToolCalls,
  currentAgentContextID,
  nativeToolSafetyEvents,
} from "./artifact-safety.js";
import { ProviderManager } from "./provider-manager.js";
import {
  captureDirectory,
  sessionPath,
  stateDirectory,
  toolCacheDirectory,
  profileDirectory,
} from "./paths.js";
import { renderModsPage, renderSettingsPage } from "./settings-page.js";
import { isAllowedLoopbackHostHeader } from "./network-policy.js";
import { enabledModIDs, modEnabled } from "./mods.js";
import { ModConfigStore } from "./mod-config.js";
import { AnthropicStreamWriter } from "./anthropic-stream.js";
import { isToolContinuation } from "./chat-shape.js";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.DIA_CUSTOM_BRIDGE_PORT ?? "8765", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("DIA_CUSTOM_BRIDGE_PORT must be a valid TCP port");
}
const maxBodyBytes = 16 * 1024 * 1024;
const captureEnabled = process.env.DIA_CUSTOM_CAPTURE === "1";
const stateDir = stateDirectory;
const captureDir = captureDirectory;
const sessionFile = sessionPath;
const toolCacheDir = toolCacheDirectory;
const toolCacheFiles = new Set([
  "notion.json",
  "amplitude.json",
  "granola.json",
  "salesforce.json",
  "atlassian.json",
  "zoom.json",
]);
const providerManager = new ProviderManager();
const modConfigStore = new ModConfigStore();
const sessions = new Map();
const { privateKey: signaturePrivateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

function jsonResponse(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function jsonDownloadResponse(response, fileName, value) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

async function loadLocalSessions() {
  try {
    const saved = JSON.parse(await readFile(sessionFile, "utf8"));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [token, session] of Object.entries(saved)) {
      if (typeof session?.key === "string" && session.createdAt >= cutoff) {
        sessions.set(token, {
          key: Buffer.from(session.key, "base64"),
          createdAt: session.createdAt,
        });
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function saveLocalSessions() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const saved = Object.fromEntries(
    [...sessions.entries()].map(([token, session]) => [token, {
      key: session.key.toString("base64"),
      createdAt: session.createdAt,
    }]),
  );
  await writeFile(sessionFile, JSON.stringify(saved), { mode: 0o600 });
}

async function establishLocalSession(clientPublicKeyBase64) {
  const clientRaw = Buffer.from(clientPublicKeyBase64, "base64");
  if (clientRaw.length !== 64 && clientRaw.length !== 65) {
    throw new Error(`clientPublicKey must decode to 64 or 65 bytes, got ${clientRaw.length}`);
  }

  const clientUncompressed = clientRaw.length === 64
    ? Buffer.concat([Buffer.from([0x04]), clientRaw])
    : clientRaw;
  const serverECDH = createECDH("prime256v1");
  serverECDH.generateKeys();
  const serverUncompressed = serverECDH.getPublicKey(undefined, "uncompressed");
  const serverRaw = serverUncompressed.subarray(1);
  // Dia hashes the raw P-256 ECDH shared secret with SHA-256 before creating
  // its CryptoKit SymmetricKey.
  const sessionKey = createHash("sha256")
    .update(serverECDH.computeSecret(clientUncompressed))
    .digest();
  const sessionToken = randomBytes(32).toString("base64");

  // Dia parses this as a DER-encoded P-256 ECDSA signature before its local
  // trust policy runs. The localhost-only build deliberately supplies its own
  // trust boundary, while preserving that native response/parser contract.
  const signature = sign("sha256", serverRaw, signaturePrivateKey);
  sessions.set(sessionToken, {
    key: sessionKey,
    createdAt: Date.now(),
  });
  await saveLocalSessions();

  return {
    serverEphemeralPublicKey: serverRaw.toString("base64"),
    ephemeralPublicKeySignature: signature.toString("base64"),
    encryptedSharedSecret: sessionToken,
  };
}

function encryptDiaData(sessionKey, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "chacha20-poly1305",
    sessionKey,
    nonce,
    { authTagLength: 16 },
  );
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString("base64");
}

function writeOpenAIStream(response, content, sessionKey, model = "dia-custom-local") {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "x-response-encrypted": "true",
  });
  const chunks = [
    {
      choices: [{
        delta: { role: "assistant", content },
        finish_reason: null,
      }],
    },
    {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      model,
    },
  ];
  for (const chunk of chunks) {
    response.write(`data: ${encryptDiaData(sessionKey, JSON.stringify(chunk))}\n\n`);
  }
  response.end(`data: ${encryptDiaData(sessionKey, "[DONE]")}\n\n`);
}

function writeAnthropicEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function classifierResponse() {
  return JSON.stringify({
    requiresReasoning: false,
    doesRequestUnsupportedCapability: false,
    requiresWebSearch: false,
    isWritingRelated: false,
    isCodingRelated: false,
  });
}

function responseContextLabelsResponse() {
  // These labels are optional UI metadata for attaching citations/context
  // chips to a completed response. Local providers currently return plain text,
  // so there are no Dia-managed context identifiers to label.
  return JSON.stringify({
    header: "",
    labels: [],
  });
}

async function streamProviderAsAnthropic(response, payload) {
  const { key: model } = await providerManager.selectedProvider();
  const contextID = currentAgentContextID(payload, profileDirectory);
  const messageId = `msg_dia_custom_${randomBytes(12).toString("hex")}`;

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
  });
  const stream = new AnthropicStreamWriter(response, { messageID: messageId, model });
  const streamedReportWrites = new Set();
  stream.startMessage();
  const initialStatus = Array.isArray(payload.tools) && payload.tools.length > 0
    ? "Reviewing the browser context and available tools..."
    : "Reviewing the request and browser context...";
  if (!isToolContinuation(payload)) stream.writeStatus(initialStatus);

  let result;
  try {
    ({ result } = await providerManager.run(payload, {
      onReasoning: async (delta) => {
        stream.writeReasoning(delta);
      },
      onStatus: async (status) => {
        stream.writeStatus(status);
      },
      onLocalToolActivity: async (activity) => {
        if (activity.phase === "start") {
          for (const call of activity.calls) stream.writeLocalToolUse(call);
        } else if (activity.phase === "finish") {
          for (const { call, result: toolResult } of activity.results) {
            stream.writeLocalToolResult(call, toolResult);
          }
        }
      },
      onReportWriteStream: async (activity) => {
        if (activity.phase === "start") {
          streamedReportWrites.add(activity.call.id);
          stream.startNativeToolCall(activity.call);
        } else if (activity.phase === "delta") {
          stream.writeNativeToolInput(activity.call.id, activity.partialJSON);
        }
      },
    }));
  } catch (error) {
    result = {
      kind: "final",
      toolCalls: [],
      text: `The local model bridge hit an error: ${String(error?.message ?? error)}`,
      usage: null,
      model,
    };
  }

  if (result.kind === "tool_use" && result.toolCalls.length > 0) {
    const authorization = await authorizeNativeToolCalls(
      result.toolCalls,
      profileDirectory,
      { contextID, requireContext: true },
    );
    if (authorization.blocked.length > 0) {
      const blocked = authorization.blocked.at(-1);
      result = {
        ...result,
        kind: "final",
        toolCalls: [],
        text: `Dia Custom blocked ${blocked.call.name}: ${blocked.reason}.`,
      };
    } else {
      result.toolCalls = authorization.allowed;
    }
  }

  const isToolUse = result.kind === "tool_use" && result.toolCalls.length > 0;
  if (isToolUse) {
    for (const item of await nativeToolSafetyEvents(
      result.toolCalls,
      profileDirectory,
      { contextID },
    )) {
      writeAnthropicEvent(response, item.event, item.data);
    }
  }
  if (isToolUse) {
    const remainingCalls = [];
    for (const call of result.toolCalls) {
      if (streamedReportWrites.has(call.id) && stream.hasNativeToolStream(call.id)) {
        // The provider streamed the encoded content string but deliberately
        // left the JSON object open until path/tool authorization succeeded.
        stream.writeNativeToolInput(call.id, '"}');
        stream.finishNativeToolCall(call.id);
      } else {
        remainingCalls.push(call);
      }
    }
    stream.writeNativeToolCalls(remainingCalls);
  }
  else stream.writeText(result.text);
  stream.finish({
    stopReason: isToolUse ? "tool_use" : "end_turn",
    outputTokens: result.usage?.output_tokens ?? 0,
  });
  return result;
}

async function respondToAnthropicRequest(response, body) {
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return false;
  }
  if (!Array.isArray(payload?.messages) || payload.stream !== true) {
    return false;
  }
  const toolCount = Array.isArray(payload.tools) ? payload.tools.length : 0;
  const { key: selectedModel } = await providerManager.selectedProvider();
  process.stdout.write(
    `Routing Dia Custom native new chat to ${selectedModel} (${toolCount} native tools)\n`,
  );
  const result = await streamProviderAsAnthropic(response, payload);
  if (result.kind === "tool_use") {
    process.stdout.write(
      `Returned ${result.toolCalls.length} native Dia tool call(s): ${result.toolCalls.map((call) => call.name).join(", ")}\n`,
    );
  } else {
    process.stdout.write(`Returned ${selectedModel} response to Dia Custom native new chat\n`);
  }
  return true;
}

async function respondToAIProxy(request, response, body) {
  const session = sessions.get(request.headers["x-server-data-encrypted"]);
  if (!session) throw new Error("unknown local Dia encryption session");
  const plaintext = decryptDiaRequest(request, body);
  const payload = JSON.parse(plaintext.toString("utf8"));

  if (payload.feature === "classifier") {
    writeOpenAIStream(response, classifierResponse(), session.key, payload.model);
    process.stdout.write("Answered Dia Custom classifier locally\n");
    return;
  }

  if (
    payload.feature === "supertabs" &&
    payload.sub_feature === "response_context_labels"
  ) {
    writeOpenAIStream(
      response,
      responseContextLabelsResponse(),
      session.key,
      payload.model,
    );
    process.stdout.write("Answered Dia Custom response labels locally\n");
    return;
  }

  const { key: selectedModel } = await providerManager.selectedProvider();
  process.stdout.write(
    `Routing Dia Custom ${payload.feature ?? "chat"}/${payload.sub_feature ?? "request"} to ${selectedModel}\n`,
  );
  const { result } = await providerManager.run(payload);
  if (result.kind === "tool_use") {
    throw new Error("the legacy AI proxy cannot execute native tool calls; use New Chat");
  }
  writeOpenAIStream(response, result.text, session.key, result.model);
  process.stdout.write(`Returned ${selectedModel} response to Dia Custom\n`);
}

function decryptDiaRequest(request, body) {
  const sessionToken = request.headers["x-server-data-encrypted"];
  if (typeof sessionToken !== "string") return null;
  const session = sessions.get(sessionToken);
  if (!session) throw new Error("unknown local Dia encryption session");
  if (body.length < 28) throw new Error("encrypted Dia request is too short");

  // CryptoKit ChaChaPoly's combined representation is nonce (12 bytes),
  // ciphertext, then authentication tag (16 bytes).
  const nonce = body.subarray(0, 12);
  const ciphertext = body.subarray(12, -16);
  const tag = body.subarray(-16);
  const decipher = createDecipheriv(
    "chacha20-poly1305",
    session.key,
    nonce,
    { authTagLength: 16 },
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function redactedShape(value, depth = 0) {
  if (depth > 12) return "<max-depth>";
  if (value === null) return null;
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, 4).map((item) => redactedShape(item, depth + 1)),
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactedShape(item, depth + 1)]),
    );
  }
  if (typeof value === "string") return { type: "string", length: value.length };
  return { type: typeof value, value };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeHeaders(headers) {
  const blocked = new Set(["authorization", "cookie", "x-api-key"]);
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      blocked.has(key.toLowerCase()) ? "<redacted>" : value,
    ]),
  );
}

async function captureRequest(request, body) {
  let parsed = null;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    // The raw body is retained only in explicit capture mode.
  }

  let decrypted = null;
  let decryptionError = null;
  if (request.url === "/ai-service-local-v1/aiproxy") {
    try {
      const plaintext = decryptDiaRequest(request, body);
      if (plaintext) {
        try {
          decrypted = JSON.parse(plaintext.toString("utf8"));
        } catch {
          decrypted = plaintext.toString("utf8");
        }
      }
    } catch (error) {
      decryptionError = String(error?.message ?? error);
    }
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const record = {
    capturedAt: new Date().toISOString(),
    method: request.method,
    url: request.url,
    headers: safeHeaders(request.headers),
    bodyEncoding: parsed === null ? "base64" : "json",
    body: parsed ?? body.toString("base64"),
    ...(decrypted === null ? {} : { decryptedBody: decrypted }),
    ...(decryptionError === null ? {} : { decryptionError }),
  };
  const shape = {
    ...record,
    body: parsed === null
      ? { type: "binary", length: body.length }
      : redactedShape(parsed),
    ...(decrypted === null ? {} : { decryptedBody: redactedShape(decrypted) }),
  };

  await mkdir(captureDir, { recursive: true });
  await writeFile(resolve(captureDir, `${timestamp}-request.json`), JSON.stringify(record, null, 2));
  await writeFile(resolve(captureDir, `${timestamp}-shape.json`), JSON.stringify(shape, null, 2));
  const isTelemetry = request.url?.startsWith("/dd-local-xxxxx/") ||
    /^\/api\/\d+\/envelope\/$/.test(request.url ?? "");
  process.stdout.write(isTelemetry
    ? `Captured local telemetry ${request.method} ${request.url} (${body.length} bytes)\n`
    : `${JSON.stringify(shape, null, 2)}\n`);
}

async function hasAdminToken(request) {
  const config = await providerManager.configStore.load();
  return request.headers["x-dia-custom-token"] === config.adminToken;
}

function htmlResponse(response, content) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  response.end(content);
}

async function handleRequest(request, response) {
  if (!isAllowedLoopbackHostHeader(request.headers.host, port)) {
    jsonResponse(response, 421, { error: "loopback_host_required" });
    return;
  }
  const requestURL = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (request.method === "GET" && request.url === "/health") {
    const { key: selectedModel } = await providerManager.selectedProvider();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      mode: captureEnabled ? "capture" : "bridge",
      selectedModel,
      enabledMods: enabledModIDs(),
    }));
    return;
  }

  if (request.method === "GET" && ["/", "/settings"].includes(requestURL.pathname)) {
    const config = await providerManager.configStore.load();
    htmlResponse(response, renderSettingsPage(config.adminToken));
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/mods") {
    const config = await providerManager.configStore.load();
    htmlResponse(response, renderModsPage(config.adminToken));
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/models") {
    try {
      jsonResponse(response, 200, await providerManager.publicCatalog({
        force: requestURL.searchParams.get("refresh") === "1",
      }));
    } catch (error) {
      jsonResponse(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/config") {
    await providerManager.configStore.load();
    jsonResponse(response, 200, providerManager.configStore.publicValue());
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/mods") {
    try {
      jsonResponse(response, 200, await modConfigStore.publicState());
    } catch (error) {
      jsonResponse(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  const modAction = requestURL.pathname.match(/^\/api\/mods\/([^/]+)$/);
  if (request.method === "PUT" && modAction) {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      jsonResponse(response, 200, await modConfigStore.setEnabled(
        decodeURIComponent(modAction[1]),
        payload.enabled,
      ));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/apps/state") {
    try {
      const profileID = requestURL.searchParams.get("profileID") ?? "Default";
      const state = await providerManager.appsStateStore.publicState(profileID);
      const connectors = modEnabled("live-connectors")
        ? await providerManager.connectorRegistry.status(profileID)
        : [];
      jsonResponse(response, 200, { ...state, connectors });
    } catch (error) {
      jsonResponse(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "PUT" && requestURL.pathname === "/api/apps/morning-brief") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      if (!modEnabled("morning-brief")) throw new Error("morning-brief mod is disabled");
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      await providerManager.appsStateStore.setMorningBrief(payload);
      jsonResponse(
        response,
        200,
        await providerManager.appsStateStore.publicState(payload.profileID ?? "Default"),
      );
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/apps/morning-brief/status") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      await providerManager.appsStateStore.recordMorningBrief(payload);
      jsonResponse(response, 200, await providerManager.appsStateStore.publicState(payload.profileID));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/apps/native-state") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      if (!modEnabled("native-apps")) throw new Error("native-apps mod is disabled");
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      await providerManager.appsStateStore.updateNativeState(payload);
      jsonResponse(response, 200, await providerManager.appsStateStore.publicState(payload.profileID));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  const connectorAction = requestURL.pathname.match(
    /^\/api\/apps\/connectors\/([^/]+)\/(connect|reconnect|disconnect)$/,
  );
  if (request.method === "POST" && connectorAction) {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      if (!modEnabled("live-connectors")) throw new Error("live-connectors mod is disabled");
      const connectorID = decodeURIComponent(connectorAction[1]);
      const action = connectorAction[2];
      const value = action === "disconnect"
        ? await providerManager.connectorRegistry.disconnect(connectorID)
        : await providerManager.connectorRegistry.connect(connectorID);
      jsonResponse(response, 200, value);
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/apps/oauth/callback") {
    try {
      const value = await providerManager.connectorRegistry.completeOAuth({
        state: requestURL.searchParams.get("state"),
        code: requestURL.searchParams.get("code"),
        error: requestURL.searchParams.get("error"),
      });
      htmlResponse(response, `<!doctype html><meta charset="utf-8"><title>Connected</title><p>${value.connector} is connected to Dia Custom. You can close this tab.</p>`);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end("<!doctype html><meta charset=\"utf-8\"><title>Connection failed</title><p>The connector could not be connected. Return to Dia Custom and try again.</p>");
    }
    return;
  }

  // Dia's bundled MCP proxy calls these two native tool names so the browser
  // can retain its own activity UI. The implementation remains localhost-only
  // and inherits LocalWebTools' public-address and Dia-domain restrictions.
  if (request.method === "POST" && requestURL.pathname === "/t") {
    try {
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      if (!["search_web", "fetch_web_content"].includes(payload?.n)) {
        throw new Error("unsupported native local tool");
      }
      const result = await providerManager.localTools.execute(
        {
          name: `mcp__dia-tools__${payload.n}`,
          input: payload.i,
        },
        { profileID: "Default" },
      );
      jsonResponse(response, 200, result);
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/memory/enabled") {
    const config = await providerManager.configStore.load();
    jsonResponse(response, 200, {
      ...config.localMemory,
      stats: await providerManager.memoryStore.stats(),
    });
    return;
  }

  if (request.method === "PUT" && requestURL.pathname === "/api/memory/enabled") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      const localMemory = await providerManager.setLocalMemoryEnabled(payload.enabled);
      jsonResponse(response, 200, localMemory);
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "PUT" && requestURL.pathname === "/api/memory/retention") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      jsonResponse(
        response,
        200,
        await providerManager.setLocalMemoryRetention(
          payload.retentionDays,
          typeof payload.profileID === "string" ? payload.profileID : null,
        ),
      );
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/credentials") {
    if (!await hasAdminToken(request)) {
      jsonResponse(response, 403, { error: "invalid local administration token" });
      return;
    }
    const config = await providerManager.configStore.load();
    jsonResponse(response, 200, await providerManager.credentialStore.status(config.providers));
    return;
  }

  if (["PUT", "DELETE"].includes(request.method) &&
      requestURL.pathname.startsWith("/api/credentials/")) {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const providerID = decodeURIComponent(requestURL.pathname.slice("/api/credentials/".length));
      const config = await providerManager.configStore.load();
      const provider = config.providers.find((candidate) => candidate.id === providerID);
      if (!provider || provider.type !== "openai-compatible") {
        throw new Error("credentials can only be set for a configured OpenAI-compatible provider");
      }
      if (request.method === "PUT") {
        const payload = JSON.parse((await readBody(request)).toString("utf8"));
        await providerManager.credentialStore.set(providerID, payload.secret);
      } else {
        await providerManager.credentialStore.delete(providerID);
      }
      await providerManager.refreshCatalog({ force: true });
      jsonResponse(response, 200, { ok: true });
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/memory") {
    if (!await hasAdminToken(request)) {
      jsonResponse(response, 403, { error: "invalid local administration token" });
      return;
    }
    jsonResponse(response, 200, await providerManager.memoryStore.stats());
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/memory/export") {
    if (!await hasAdminToken(request)) {
      jsonResponse(response, 403, { error: "invalid local administration token" });
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    jsonDownloadResponse(
      response,
      `dia-custom-memory-${date}.json`,
      await providerManager.memoryStore.exportEntries(),
    );
    return;
  }

  if (request.method === "DELETE" && requestURL.pathname === "/api/memory") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8") || "{}");
      jsonResponse(response, 200, await providerManager.memoryStore.deleteEntries(payload));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/memory/prune") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const config = await providerManager.configStore.load();
      jsonResponse(response, 200, await providerManager.memoryStore.prune(config.localMemory));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/connectors") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      jsonResponse(response, 200, { connectors: await providerManager.memoryStore.connectors() });
    } catch (error) {
      jsonResponse(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/api/tools") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      jsonResponse(response, 200, await providerManager.toolCoverageStore.publicValue());
    } catch (error) {
      jsonResponse(response, 500, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "POST" && requestURL.pathname === "/api/connectors/import") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      jsonResponse(response, 200, await providerManager.memoryStore.importConnector(payload));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "DELETE" && requestURL.pathname.startsWith("/api/connectors/")) {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const id = decodeURIComponent(requestURL.pathname.slice("/api/connectors/".length));
      jsonResponse(response, 200, await providerManager.memoryStore.deleteConnector(id));
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "PUT" && requestURL.pathname === "/api/selection") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      const catalog = await providerManager.select(payload.model);
      jsonResponse(response, 200, { ok: true, selectedModel: catalog.selectedModel });
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "PUT" && requestURL.pathname === "/api/config") {
    try {
      if (!await hasAdminToken(request)) {
        jsonResponse(response, 403, { error: "invalid local administration token" });
        return;
      }
      const payload = JSON.parse((await readBody(request)).toString("utf8"));
      await providerManager.updateConfig(payload);
      jsonResponse(response, 200, providerManager.configStore.publicValue());
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "GET" && request.url === "/updates-disabled.xml") {
    response.writeHead(200, {
      "content-type": "application/xml",
      "cache-control": "no-store",
    });
    response.end(
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<rss version="2.0"><channel><title>Dia Custom updates are disabled</title></channel></rss>',
    );
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/tools-cache-local-xx/")) {
    const fileName = request.url.slice("/tools-cache-local-xx/".length);
    if (!toolCacheFiles.has(fileName)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "tool_cache_not_found" }));
      return;
    }
    const contents = await readFile(resolve(toolCacheDir, fileName));
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(contents);
    return;
  }

  if (request.method === "POST" && request.url === "/ai-service-local-v1/key-exchange") {
    try {
      const body = await readBody(request);
      if (captureEnabled) await captureRequest(request, body);
      const payload = JSON.parse(body.toString("utf8"));
      if (typeof payload.clientPublicKey !== "string") {
        throw new Error("clientPublicKey is required");
      }
      const session = await establishLocalSession(payload.clientPublicKey);
      jsonResponse(response, 200, session);
      process.stdout.write("Established a local Dia Custom encryption session\n");
    } catch (error) {
      jsonResponse(response, 400, { error: String(error?.message ?? error) });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/ai-service-local-v1/aiproxy") {
    let body = null;
    try {
      body = await readBody(request);
      if (captureEnabled) await captureRequest(request, body);
      await respondToAIProxy(request, response, body);
    } catch (error) {
      const session = sessions.get(request.headers["x-server-data-encrypted"]);
      const message = String(error?.message ?? error);
      process.stderr.write(`Dia Custom AI bridge error: ${message}\n`);
      if (session && !response.headersSent) {
        writeOpenAIStream(
          response,
          `The local model bridge hit an error: ${message}`,
          session.key,
          "dia-custom-error",
        );
      } else if (!response.headersSent) {
        jsonResponse(response, 400, { error: message });
      } else {
        response.end();
      }
    }
    return;
  }

  if (captureEnabled) {
    try {
      const body = await readBody(request);
      await captureRequest(request, body);
      const isLocalTelemetry = request.url?.startsWith("/dd-local-xxxxx/") ||
        /^\/api\/\d+\/envelope\/$/.test(request.url ?? "");
      if (isLocalTelemetry) {
        response.writeHead(202, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: "dia_custom_capture_complete",
        message: "The native request was captured locally; no upstream server was contacted.",
      }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error?.message ?? error) }));
    }
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  try {
    const body = await readBody(request);
    if (await respondToAnthropicRequest(response, body)) {
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "local_route_not_found" }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const message = String(error?.message ?? error);
    process.stderr.write(`Dia Custom local HTTP error: ${message}\n`);
    if (!response.headersSent) {
      jsonResponse(response, 500, { error: message });
    } else if (!response.writableEnded) {
      response.end();
    }
  });
});

await loadLocalSessions();
await providerManager.initialize();

server.listen(port, host, () => {
  process.stdout.write(`Dia Custom bridge listening on http://${host}:${port}\n`);
  process.stdout.write(`Mode: ${captureEnabled ? "capture" : "bridge"}\n`);
  process.stdout.write(`Model settings: http://${host}:${port}/settings\n`);
});
