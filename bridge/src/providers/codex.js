import { Codex } from "@openai/codex-sdk";
import { mkdir } from "node:fs/promises";
import {
  buildDecisionPrompt,
  parseStructuredDecision,
  toolDecisionSchema,
} from "../chat-shape.js";
import { decisionWorkspacePath } from "../paths.js";

const codex = new Codex({
  config: { model_reasoning_summary: "detailed" },
  // Do not expose provider keys or bridge state paths to the subprocess. Codex
  // uses the user's normal ~/.codex login through HOME.
  env: Object.fromEntries([
    "HOME", "LANG", "LC_ALL", "LOGNAME", "PATH", "SHELL", "TERM", "TMPDIR", "USER",
  ].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])),
});

function reasoningEffort(payload, model) {
  const requested = payload?.reasoning_effort;
  if (["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(requested)) {
    return requested;
  }
  if (model.includes("luna")) return "low";
  if (model.includes("sol")) return "high";
  return "medium";
}

export async function runCodexProvider({ payload, tools, model, onReasoning }) {
  await mkdir(decisionWorkspacePath, { recursive: true, mode: 0o700 });
  const thread = codex.startThread({
    model,
    sandboxMode: "read-only",
    workingDirectory: decisionWorkspacePath,
    skipGitRepoCheck: true,
    modelReasoningEffort: reasoningEffort(payload, model),
    webSearchMode: "disabled",
    networkAccessEnabled: false,
    approvalPolicy: "never",
  });
  const abort = new AbortController();
  const { events } = await thread.runStreamed(
    buildDecisionPrompt(payload, tools),
    {
      ...(tools.length > 0 ? { outputSchema: toolDecisionSchema } : {}),
      signal: abort.signal,
    },
  );

  const reasoningByID = new Map();
  let finalResponse = "";
  let usage = null;
  let failure = null;
  try {
    for await (const event of events) {
      if (
        ["item.started", "item.updated", "item.completed"].includes(event.type) &&
        ["command_execution", "file_change", "mcp_tool_call", "web_search"].includes(event.item?.type)
      ) {
        failure = { message: `Codex attempted a disabled built-in action (${event.item.type})` };
        abort.abort();
        break;
      }
      if (
        ["item.started", "item.updated", "item.completed"].includes(event.type) &&
        event.item?.type === "reasoning"
      ) {
        const previous = reasoningByID.get(event.item.id) ?? "";
        const current = event.item.text ?? "";
        const delta = current.startsWith(previous) ? current.slice(previous.length) : current;
        reasoningByID.set(event.item.id, current);
        if (delta && onReasoning) await onReasoning(delta);
      } else if (event.type === "item.completed" && event.item?.type === "agent_message") {
        finalResponse = event.item.text ?? "";
      } else if (event.type === "turn.completed") {
        usage = event.usage ?? null;
      } else if (event.type === "turn.failed") {
        failure = event.error;
        break;
      } else if (event.type === "error") {
        failure = { message: event.message };
        break;
      }
    }
  } catch (error) {
    if (!failure) throw error;
  }
  if (failure) throw new Error(failure.message ?? "Codex turn failed");

  if (tools.length === 0) {
    return {
      kind: "final",
      toolCalls: [],
      text: finalResponse || "Codex completed without a text response.",
      usage,
      model,
    };
  }
  try {
    return parseStructuredDecision(finalResponse, tools, model, usage);
  } catch (error) {
    process.stderr.write(`Codex decision parse error: ${String(error?.message ?? error)}\n`);
    return {
      kind: "final",
      toolCalls: [],
      text: finalResponse || "Codex completed without a text response.",
      usage,
      model,
    };
  }
}
