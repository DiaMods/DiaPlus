import { Codex } from "@openai/codex-sdk";
import {
  buildDecisionPrompt,
  parseStructuredDecision,
  toolDecisionSchema,
} from "../chat-shape.js";
import { bridgeDirectory } from "../paths.js";

const codex = new Codex({
  config: { model_reasoning_summary: "detailed" },
});

function reasoningEffort(payload) {
  const requested = payload?.reasoning_effort;
  if (["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(requested)) {
    return requested;
  }
  return "medium";
}

export async function runCodexProvider({ payload, tools, model, onReasoning }) {
  const thread = codex.startThread({
    model,
    sandboxMode: "danger-full-access",
    workingDirectory: process.env.DIA_CUSTOM_WORKSPACE ?? bridgeDirectory,
    skipGitRepoCheck: true,
    modelReasoningEffort: reasoningEffort(payload),
    webSearchMode: "live",
    networkAccessEnabled: true,
    approvalPolicy: "never",
  });
  const { events } = await thread.runStreamed(
    buildDecisionPrompt(payload, tools),
    tools.length > 0 ? { outputSchema: toolDecisionSchema } : undefined,
  );

  const reasoningByID = new Map();
  let finalResponse = "";
  let usage = null;
  let failure = null;
  for await (const event of events) {
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

