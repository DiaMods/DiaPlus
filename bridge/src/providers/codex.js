import { createDecisionCodex } from "./codex-runtime.js";
import { mkdir } from "node:fs/promises";
import {
  buildDecisionPrompt,
  parseStructuredDecision,
  reportWorkflowRequiresTool,
  toolDecisionSchemaForPayload,
} from "../chat-shape.js";
import { decisionWorkspacePath } from "../paths.js";
import { prepareMediaPayload } from "../media-inputs.js";
import { FinalTextStream, partialFinalText } from "./decision-stream.js";


function reasoningEffort(payload, metadata, tools) {
  const requested = payload?.reasoning_effort;
  const supported = metadata?.supportedReasoningEfforts?.map(option => option.reasoningEffort) ?? [];
  if (requested && supported.includes(requested)) return requested;
  if (reportWorkflowRequiresTool(payload, tools) && supported.includes("medium")) return "medium";
  return metadata?.defaultReasoningEffort;
}

export async function runCodexProvider({ payload, tools, model, modelMetadata, onReasoning, onTextDelta, codexClient = null }) {
  codexClient ??= await createDecisionCodex();
  const media = await prepareMediaPayload(payload, { target: "codex" });
  try {
    return await runCodexTurn({ payload: media.payload, images: media.images, tools, model, modelMetadata, onReasoning, onTextDelta, codexClient });
  } finally { await media.cleanup(); }
}

async function runCodexTurn({ payload, images, tools, model, modelMetadata, onReasoning, onTextDelta, codexClient }) {
  await mkdir(decisionWorkspacePath, { recursive: true, mode: 0o700 });
  const effort = reasoningEffort(payload, modelMetadata, tools);
  const thread = codexClient.startThread({
    model,
    sandboxMode: "read-only",
    workingDirectory: decisionWorkspacePath,
    skipGitRepoCheck: true,
    ...(effort ? { modelReasoningEffort: effort } : {}),
    webSearchMode: "disabled",
    networkAccessEnabled: false,
    approvalPolicy: "never",
  });
  const abort = new AbortController();
  const prompt = buildDecisionPrompt(payload, tools) + (tools.length ? "" :
    "\nNo tools are enabled in this turn. Return the answer directly as Markdown, without a JSON decision envelope.");
  const { events } = await thread.runStreamed(
    images.length ? [
      { type: "text", text: prompt + "\nImage attachments below correspond to attachment-1, attachment-2, etc. in transcript order." },
      ...images.map(({ path }) => ({ type: "local_image", path })),
    ] : prompt,
    {
      ...(tools.length > 0 ? { outputSchema: toolDecisionSchemaForPayload(payload, tools) } : {}),
      signal: abort.signal,
    },
  );

  const reasoningByID = new Map();
  const textStream = new FinalTextStream(onTextDelta);
  let messageID = null;
  let completed = false;
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
      } else if (["item.started", "item.updated", "item.completed"].includes(event.type) && event.item?.type === "agent_message") {
        if (messageID && messageID !== event.item.id && textStream.text) {
          throw new Error("Codex emitted multiple final messages after streaming");
        }
        messageID = event.item.id;
        finalResponse = event.item.text ?? "";
        const text = tools.length ? partialFinalText(finalResponse) : finalResponse;
        if (text) await textStream.push(text);
      } else if (event.type === "turn.completed") {
        completed = true;
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
  if (!completed) throw new Error("Codex stream ended before turn completion");

  if (tools.length === 0) {
    await textStream.push(finalResponse || "Codex completed without a text response.");
    return {
      kind: "final",
      toolCalls: [],
      text: finalResponse || "Codex completed without a text response.",
      usage,
      model,
    };
  }
  // Invalid structured output is a provider error. Never leak the decision JSON
  // as an answer or reinterpret malformed tool calls as successful completion.
  const raw = JSON.parse(finalResponse);
  if (!["final", "tool_use"].includes(raw?.kind) || !Array.isArray(raw.tool_calls) ||
      (raw.kind === "final" && raw.tool_calls.length !== 0)) {
    throw new Error("Codex returned an invalid structured decision");
  }
  const result = parseStructuredDecision(raw, tools, model, usage);
  if (raw.kind === "tool_use" && result.kind !== "tool_use") throw new Error("Codex returned no valid tool calls");
  if (result.kind === "final") await textStream.push(result.text);
  else if (textStream.text) throw new Error("Codex changed a streamed answer into a tool call");
  return result;
}
