import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { buildDecisionPrompt, parseStructuredDecision } from "../chat-shape.js";
import { appleModelHelperPath } from "../paths.js";

async function runHelper(request) {
  await access(appleModelHelperPath);
  const child = spawn(appleModelHelperPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(`${JSON.stringify(request)}\n`);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const lines = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    try {
      lines.push(JSON.parse(line));
    } catch {
      // Preserve the helper's stderr/exit diagnostic below if a process was
      // terminated before it could finish a JSON line.
    }
  }
  const error = lines.find((line) => line.type === "error");
  if (error) throw new Error(error.message);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Apple model helper exited with ${exitCode}`);
  }
  return lines.findLast((line) => line.type === "result")?.value;
}

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

export async function runAppleProvider({ provider, payload, tools, model, onReasoning }) {
  if (onReasoning) {
    await onReasoning(provider.mode === "on-device"
      ? "Using Apple Intelligence on this Mac..."
      : "Using Apple Private Cloud Compute...");
  }
  const structured = tools.length > 0;
  const value = await runHelper({
    action: "generate",
    mode: provider.mode,
    prompt: structured ? buildDecisionPrompt(payload, tools) : buildDecisionPrompt(payload, []),
    structured,
    toolsJSON: structured ? JSON.stringify(tools) : null,
    maximumResponseTokens: payload?.max_tokens ?? null,
  });
  if (!structured) {
    return { kind: "final", toolCalls: [], text: value.text ?? "", usage: value.usage ?? null, model };
  }
  return parseStructuredDecision(value, tools, model, value.usage ?? null);
}
