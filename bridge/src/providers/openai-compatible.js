import { randomBytes } from "node:crypto";
import {
  contentAsText,
  reportWorkflowRequiresTool,
  systemAsText,
} from "../chat-shape.js";
import { joinProviderURL } from "../network-policy.js";
import { imageSourceURL, prepareMediaPayload } from "../media-inputs.js";
import { parseServerSentEvents } from "./sse.js";

function providerHeaders(provider, apiKey) {
  const headers = { "content-type": "application/json" };
  if (provider.apiKeyEnv && !apiKey) throw new Error(`${provider.label} needs an API credential`);
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function toolDefinitions(tools, style) {
  return tools.map((tool) => style === "responses"
    ? {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      strict: false,
    }
    : {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    });
}

function userContent(blocks, style) {
  const parts = blocks.flatMap((block) => {
    if (block?.type === "image") {
      const url = imageSourceURL(block);
      return [style === "responses"
        ? { type: "input_image", image_url: url, detail: "auto" }
        : { type: "image_url", image_url: { url } }];
    }
    if (["document", "audio", "video"].includes(block?.type)) {
      if (block.type === "document" && block.source?.media_type === "application/pdf" && block.source.type === "base64") {
        const filename = String(block.title || "attachment.pdf").replace(/[\\/\x00-\x1f]/g, "_").slice(0, 180);
        const data = `data:application/pdf;base64,${block.source.data}`;
        return [style === "responses"
          ? { type: "input_file", filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`, file_data: data }
          : { type: "file", file: { filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`, file_data: data } }];
      }
      if (block.type === "audio" && style === "chat" && block.source?.type === "base64") {
        return [{ type: "input_audio", input_audio: {
          data: block.source.data,
          format: ["audio/wav", "audio/x-wav"].includes(block.source.media_type) ? "wav" : "mp3",
        } }];
      }
      if (block.type === "document" && block.source?.type === "text") {
        const text = [block.title, block.source.data].filter(Boolean).join("\n\n");
        return [{ type: style === "responses" ? "input_text" : "text", text }];
      }
      throw new Error(`The ${style === "responses" ? "Responses" : "Chat Completions"} adapter cannot translate this ${block.type} attachment; provide extracted text or images`);
    }
    const text = contentAsText([block]);
    return text ? [{ type: style === "responses" ? "input_text" : "text", text }] : [];
  });
  return parts.every((part) => ["text", "input_text"].includes(part.type))
    ? parts.map((part) => part.text).join("\n")
    : parts;
}

function toolResultText(block) {
  const content = Array.isArray(block.content)
    ? block.content.map((part) => ["image", "document", "audio", "video"].includes(part?.type)
      ? { type: "text", text: "[Tool media is attached to the following user message.]" }
      : part)
    : block.content;
  const text = contentAsText(content);
  return block.is_error === true ? `[Tool execution failed]\n${text}` : text;
}

function toolResultImages(blocks) {
  return blocks.flatMap((block) => {
    const images = Array.isArray(block.content)
      ? block.content.filter((part) => ["image", "document", "audio", "video"].includes(part?.type))
      : [];
    return images.length > 0
      ? [{ type: "text", text: `Media from completed tool call ${block.tool_use_id}:` }, ...images]
      : [];
  });
}

function anthropicMessagesToChat(payload) {
  const output = [];
  const system = systemAsText(payload?.system);
  if (system) output.push({ role: "system", content: system });

  for (const message of payload?.messages ?? []) {
    const blocks = Array.isArray(message?.content) ? message.content : null;
    if (!blocks) {
      output.push({ role: message?.role === "assistant" ? "assistant" : "user", content: contentAsText(message?.content) });
      continue;
    }

    if (message.role === "assistant") {
      const text = blocks.filter((block) => block?.type === "text")
        .map((block) => block.text ?? "").join("\n");
      const calls = blocks.filter((block) => block?.type === "tool_use").map((block) => ({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      }));
      output.push({
        role: "assistant",
        content: text || null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }

    const toolResults = blocks.filter((candidate) => candidate?.type === "tool_result");
    for (const block of toolResults) {
      output.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: toolResultText(block),
      });
    }
    if (toolResults.length > 0) {
      const completedResults = toolResults
        .map(toolResultText)
        .join("\n\n")
        .slice(0, 100_000);
      output.push({
        role: "user",
        content: userContent([{ type: "text", text: [
          "The preceding tool call completed. Use its exact result below now.",
          "Do not claim it is pending or unavailable, and do not repeat the same call; request another tool only if this completed result is genuinely insufficient.",
          "<completed-tool-result>",
          completedResults,
          "</completed-tool-result>",
        ].join("\n") }, ...toolResultImages(toolResults)], "chat"),
      });
    }
    // OpenAI requires every pending tool result before the next user message.
    const remaining = blocks.filter((block) => block?.type !== "tool_result");
    if (remaining.length > 0) output.push({ role: "user", content: userContent(remaining, "chat") });
  }
  return output;
}

function anthropicMessagesToResponses(payload) {
  const output = [];
  for (const message of payload?.messages ?? []) {
    const blocks = Array.isArray(message?.content) ? message.content : null;
    if (!blocks) {
      output.push({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: contentAsText(message?.content),
      });
      continue;
    }
    const remaining = blocks.filter((block) => !["tool_use", "tool_result"].includes(block?.type));
    const assistantText = remaining.filter((block) => block?.type === "text");
    if (message.role === "assistant" && assistantText.length > 0) {
      output.push({ role: "assistant", content: contentAsText(assistantText) });
    }
    for (const block of blocks) {
      if (block?.type === "tool_use") {
        output.push({
          type: "function_call",
          id: block.id,
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        });
      } else if (block?.type === "tool_result") {
        output.push({
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: toolResultText(block),
        });
      }
    }
    if (message.role !== "assistant") {
      const images = toolResultImages(blocks.filter((block) => block?.type === "tool_result"));
      if (remaining.length > 0 || images.length > 0) {
        output.push({ role: "user", content: userContent([...images, ...remaining], "responses") });
      }
    }
  }
  return output;
}

async function checkedFetch(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 3000);
    throw new Error(`provider HTTP ${response.status}: ${body}`);
  }
  return response;
}

async function runChatCompletions({
  provider,
  payload,
  tools,
  model,
  apiKey,
  onReasoning,
  onTextDelta,
  onToolStart,
  onToolInputDelta,
}) {
  const body = {
    model,
    messages: anthropicMessagesToChat(payload),
    tools: tools.length > 0 ? toolDefinitions(tools, "chat") : undefined,
    tool_choice: tools.length > 0
      ? reportWorkflowRequiresTool(payload, tools) ? "required" : "auto"
      : undefined,
    stream: true,
    stream_options: { include_usage: true },
  };
  const response = await checkedFetch(joinProviderURL(provider.baseURL, "/chat/completions"), {
    method: "POST",
    headers: providerHeaders(provider, apiKey),
    body: JSON.stringify(body),
  });

  let text = "";
  let usage = null;
  const calls = new Map();
  for await (const event of parseServerSentEvents(response.body)) {
    if (event.data === "[DONE]") break;
    let chunk;
    try { chunk = JSON.parse(event.data); } catch { continue; }
    if (chunk.error) {
      throw new Error(chunk.error.message ?? "Chat Completions stream failed");
    }
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta ?? {};
    if (typeof delta.content === "string") {
      text += delta.content;
      if (delta.content && onTextDelta) await onTextDelta(delta.content);
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
    if (typeof reasoning === "string" && reasoning && onReasoning) {
      await onReasoning(reasoning);
    }
    for (const partial of delta.tool_calls ?? []) {
      const key = partial.index ?? partial.id ?? calls.size;
      const existing = calls.get(key) ?? {
        id: partial.id,
        name: "",
        arguments: "",
        startNotified: false,
      };
      if (partial.id) existing.id = partial.id;
      if (partial.function?.name) {
        existing.name += partial.function.name;
        if (!existing.startNotified && tools.some((tool) => tool.name === existing.name)) {
          existing.startNotified = true;
          if (onToolStart) await onToolStart(existing);
        }
      }
      if (partial.function?.arguments) {
        existing.arguments += partial.function.arguments;
        if (onToolInputDelta) {
          await onToolInputDelta({
            id: existing.id,
            name: existing.name,
            delta: partial.function.arguments,
            accumulated: existing.arguments,
          });
        }
      }
      calls.set(key, existing);
    }
  }

  const toolCalls = [...calls.values()].flatMap((call) => {
    try {
      const input = JSON.parse(call.arguments || "{}");
      return [{
        id: call.id ?? `call_dia_custom_${randomBytes(12).toString("hex")}`,
        name: call.name,
        input,
      }];
    } catch {
      return [];
    }
  });
  return toolCalls.length > 0
    ? { kind: "tool_use", toolCalls, text: "", usage, model }
    : { kind: "final", toolCalls: [], text, usage, model };
}

async function runResponses({
  provider,
  payload,
  tools,
  model,
  apiKey,
  onReasoning,
  onTextDelta,
  onToolStart,
  onToolInputDelta,
}) {
  const body = {
    model,
    instructions: systemAsText(payload?.system) || undefined,
    input: anthropicMessagesToResponses(payload),
    tools: tools.length > 0 ? toolDefinitions(tools, "responses") : undefined,
    tool_choice: tools.length > 0
      ? reportWorkflowRequiresTool(payload, tools) ? "required" : "auto"
      : undefined,
    stream: true,
    store: false,
  };
  const response = await checkedFetch(joinProviderURL(provider.baseURL, "/responses"), {
    method: "POST",
    headers: providerHeaders(provider, apiKey),
    body: JSON.stringify(body),
  });

  let text = "";
  let usage = null;
  const calls = new Map();
  for await (const event of parseServerSentEvents(response.body)) {
    if (event.data === "[DONE]") break;
    let item;
    try { item = JSON.parse(event.data); } catch { continue; }
    const type = item.type ?? event.event;
    if (type === "error" || item.error) {
      throw new Error(item.error?.message ?? item.message ?? "OpenAI Responses stream failed");
    }
    if (type === "response.output_text.delta" && typeof item.delta === "string") {
      text += item.delta;
      if (onTextDelta) await onTextDelta(item.delta);
    }
    if (
      ["response.reasoning_summary_text.delta", "response.reasoning_text.delta"].includes(type) &&
      typeof item.delta === "string" && onReasoning
    ) {
      await onReasoning(item.delta);
    }
    if (type === "response.output_item.added" && item.item?.type === "function_call") {
      const call = {
        id: item.item.call_id ?? item.item.id,
        name: item.item.name ?? "",
        arguments: item.item.arguments ?? "",
      };
      calls.set(item.output_index ?? calls.size, call);
      if (onToolStart) await onToolStart(call);
    }
    if (type === "response.function_call_arguments.delta") {
      const key = item.output_index ?? 0;
      const existing = calls.get(key) ?? { id: item.call_id ?? item.item_id, name: "", arguments: "" };
      existing.arguments += item.delta ?? "";
      calls.set(key, existing);
      if (item.delta && onToolInputDelta) {
        await onToolInputDelta({
          id: existing.id,
          name: existing.name,
          delta: item.delta,
          accumulated: existing.arguments,
        });
      }
    }
    if (type === "response.function_call_arguments.done") {
      const key = item.output_index ?? 0;
      const existing = calls.get(key) ?? { id: item.call_id ?? item.item_id, name: item.name ?? "", arguments: "" };
      existing.name ||= item.name ?? "";
      existing.arguments = item.arguments ?? existing.arguments;
      calls.set(key, existing);
    }
    if (type === "response.completed") usage = item.response?.usage ?? null;
    if (type === "response.failed") {
      throw new Error(item.response?.error?.message ?? "OpenAI Responses request failed");
    }
    if (type === "response.incomplete") {
      throw new Error(`OpenAI Responses request was incomplete: ${item.response?.incomplete_details?.reason ?? "unknown reason"}`);
    }
  }

  const toolCalls = [...calls.values()].flatMap((call) => {
    try {
      return [{
        id: call.id ?? `call_dia_custom_${randomBytes(12).toString("hex")}`,
        name: call.name,
        input: JSON.parse(call.arguments || "{}"),
      }];
    } catch {
      return [];
    }
  });
  return toolCalls.length > 0
    ? { kind: "tool_use", toolCalls, text: "", usage, model }
    : { kind: "final", toolCalls: [], text, usage, model };
}

export async function runOpenAICompatibleProvider(options) {
  const responses = options.provider.api === "responses";
  const media = await prepareMediaPayload(options.payload, { target: responses ? "responses" : "chat" });
  try {
    return responses
      ? await runResponses({ ...options, payload: media.payload })
      : await runChatCompletions({ ...options, payload: media.payload });
  } finally { await media.cleanup(); }
}
