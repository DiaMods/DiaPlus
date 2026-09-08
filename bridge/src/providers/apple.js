import {
  buildDecisionPrompt,
  parseStructuredDecision,
  reportWorkflowRequiresTool,
} from "../chat-shape.js";
import { runAppleHelper as runHelper } from "../media-helper.js";
import { prepareMediaPayload } from "../media-inputs.js";
import { FinalTextStream } from "./decision-stream.js";

let cachedAppleStatus = null;
let cachedAppleStatusAt = 0;
const appleStatusCacheMilliseconds = 5 * 60 * 1_000;

function privateCloudReason(error) {
  const message = String(error?.message ?? error);
  if (/missing entitlement|ModelManagerError Code=1046/i.test(message)) {
    return "Apple Private Cloud Compute requires Apple's managed com.apple.developer.private-cloud-compute entitlement; this Dia Custom build does not have it.";
  }
  return `Apple Private Cloud Compute could not complete a test request: ${message}`;
}

export async function appleProviderStatus() {
  const now = Date.now();
  if (cachedAppleStatus && now - cachedAppleStatusAt < appleStatusCacheMilliseconds) {
    return cachedAppleStatus;
  }
  try {
    const status = await runHelper({ action: "status" });
    if (status?.privateCloud?.available) {
      try {
        await runHelper({ action: "probe", mode: "private-cloud" });
      } catch (error) {
        status.privateCloud = {
          available: false,
          reason: privateCloudReason(error),
        };
      }
    }
    cachedAppleStatus = status;
    cachedAppleStatusAt = now;
    return status;
  } catch (error) {
    cachedAppleStatus = {
      onDevice: { available: false, reason: String(error?.message ?? error) },
      privateCloud: { available: false, reason: String(error?.message ?? error) },
    };
    cachedAppleStatusAt = now;
    return cachedAppleStatus;
  }
}

export async function appleSentenceEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== "string")) {
    throw new Error("Apple sentence embeddings require an array of strings");
  }
  return runHelper({ action: "embed", texts });
}

export async function prepareAppleSpeech() {
  const value = await runHelper({ action: "prepare-speech" }, { timeoutMs: 600_000 });
  cachedAppleStatus = null;
  cachedAppleStatusAt = 0;
  return value;
}

export async function runAppleProvider({ provider, payload, tools, model, onReasoning, onTextDelta, helper = runHelper }) {
  const media = await prepareMediaPayload(payload, { target: provider.imageMode === "native" ? "apple" : "apple-vision", helper });
  try {
    return await runAppleTurn({ provider, payload: media.payload, images: media.images, tools, model, onReasoning, onTextDelta, helper });
  } finally { await media.cleanup(); }
}

async function runAppleTurn({ provider, payload, images, tools, model, onReasoning, onTextDelta, helper }) {
  if (onReasoning) {
    await onReasoning(provider.mode === "on-device"
      ? "Using Apple Intelligence on this Mac..."
      : "Using Apple Private Cloud Compute...");
  }
  const structured = tools.length > 0;
  const textStream = new FinalTextStream(onTextDelta);
  const value = await helper({
    action: "generate",
    stream: true,
    images,
    mode: provider.mode,
    prompt: structured ? buildDecisionPrompt(payload, tools) : buildDecisionPrompt(payload, []) +
      "\nNo tools are enabled in this turn. Return the answer directly as Markdown, without a JSON decision envelope.",
    structured,
    requireTool: structured && reportWorkflowRequiresTool(payload, tools),
    toolsJSON: structured ? JSON.stringify(tools) : null,
    maximumResponseTokens: payload?.max_tokens ?? null,
  }, { onEvent: async (event) => {
    if (event.type === "text_snapshot" && !structured) await textStream.push(event.text);
    if (event.type === "decision_snapshot" && structured) {
      // GeneratedContent emits valid partial objects with arbitrary key order.
      const snapshot = JSON.parse(event.json);
      if (snapshot.kind === "final" && typeof snapshot.text === "string" && snapshot.text) {
        await textStream.push(snapshot.text);
      }
    }
  } });
  if (!structured) {
    await textStream.push(value.text ?? "");
    return { kind: "final", toolCalls: [], text: value.text ?? "", usage: value.usage ?? null, model };
  }
  if (!["final", "tool_use"].includes(value?.kind) || !Array.isArray(value.tool_calls) ||
      (value.kind === "final" && value.tool_calls.length !== 0)) {
    throw new Error("Apple returned an invalid structured decision");
  }
  const result = parseStructuredDecision(value, tools, model, value.usage ?? null);
  if (value.kind === "tool_use" && result.kind !== "tool_use") throw new Error("Apple returned no valid tool calls");
  if (result.kind === "final") await textStream.push(result.text);
  else if (textStream.text) throw new Error("Apple changed a streamed answer into a tool call");
  return result;
}
