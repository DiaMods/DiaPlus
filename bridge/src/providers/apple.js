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
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Apple model helper exited with ${exitCode}`);
  }
  const lines = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const error = lines.find((line) => line.type === "error");
  if (error) throw new Error(error.message);
  return lines.findLast((line) => line.type === "result")?.value;
}

export async function appleProviderStatus() {
  try {
    return await runHelper({ action: "status" });
  } catch (error) {
    return {
      onDevice: { available: false, reason: String(error?.message ?? error) },
      privateCloud: { available: false, reason: String(error?.message ?? error) },
    };
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
