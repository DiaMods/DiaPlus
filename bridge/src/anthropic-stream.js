const maximumVisibleToolResultCharacters = 12_000;

function serverToolID(call) {
  return `srvtoolu_dia_custom_${String(call.id ?? "local").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function localActivity(call) {
  if (call.name?.endsWith("search_web")) {
    return {
      id: serverToolID(call),
      name: "web_search",
      input: { query: (call.input?.queries ?? []).join("\n") },
      resultType: "web_search_tool_result",
    };
  }
  if (call.name?.endsWith("fetch_web_content")) {
    return {
      id: serverToolID(call),
      name: "web_fetch",
      input: { url: call.input?.urls?.[0] ?? "" },
      resultType: "web_fetch_tool_result",
    };
  }
  const shortName = String(call.name ?? "local_tool").split("__").at(-1);
  return {
    id: serverToolID(call),
    name: "code_execution",
    input: {
      code: `dia_custom_local.${shortName}(${JSON.stringify(call.input ?? {})})`,
    },
    resultType: "code_execution_tool_result",
  };
}

function serverToolResult(activity, result) {
  if (activity.resultType === "web_search_tool_result") {
    const searches = Array.isArray(result?.searches) ? result.searches : [];
    const content = searches.flatMap((search) => search.results ?? []).map((item) => ({
      type: "web_search_result",
      title: item.title ?? item.url ?? "Search result",
      url: item.url,
      ...(item.snippet ? { page_age: null } : {}),
    })).filter((item) => typeof item.url === "string" && item.url);
    return {
      type: activity.resultType,
      tool_use_id: activity.id,
      content: result?.error
        ? { type: "web_search_tool_result_error", error_code: "unavailable" }
        : content,
    };
  }
  if (activity.resultType === "web_fetch_tool_result") {
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    const page = pages.find((item) => !item?.error) ?? pages[0];
    return {
      type: activity.resultType,
      tool_use_id: activity.id,
      content: !page || page.error || result?.error
        ? { type: "web_fetch_tool_result_error", error_code: "unavailable" }
        : {
          type: "web_fetch_result",
          url: page.url,
          retrieved_at: new Date().toISOString(),
          content: {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: visibleToolResult(page.content ?? ""),
            },
          },
        },
    };
  }
  return {
    type: activity.resultType,
    tool_use_id: activity.id,
    content: {
      type: "code_execution_result",
      stdout: result?.error ? "" : visibleToolResult(result),
      stderr: result?.error ? String(result.error) : "",
      return_code: result?.error ? 1 : 0,
      content: [],
    },
  };
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function visibleToolResult(result) {
  let value;
  try {
    value = JSON.stringify(result);
  } catch {
    value = String(result);
  }
  if (value.length <= maximumVisibleToolResultCharacters) return value;
  return `${value.slice(0, maximumVisibleToolResultCharacters)}\n… (result truncated in activity view)`;
}

function nativeToolStatus(call) {
  const shortName = String(call?.name ?? "tool").split("__").at(-1);
  const labels = {
    search_web: "Searching the web...",
    fetch_web_content: "Reading web sources...",
    open_tabs: "Opening tabs...",
    read_tabs: "Reading tabs...",
    close_tabs: "Closing tabs...",
    upload_artifact: "Adding the finished artifact to Dia...",
    Write: "Creating the artifact...",
    Skill: "Loading the required creation tools...",
  };
  return labels[shortName] ?? `Running ${shortName.replaceAll("_", " ")}...`;
}

export class AnthropicStreamWriter {
  constructor(response, { messageID, model }) {
    this.response = response;
    this.messageID = messageID;
    this.model = model;
    this.nextIndex = 0;
    this.thinkingIndex = null;
    this.thinkingHasContent = false;
    this.reasoningNeedsSeparator = false;
    this.localActivities = new Map();
    this.nativeToolStreams = new Map();
  }

  startMessage() {
    writeEvent(this.response, "message_start", {
      type: "message_start",
      message: {
        id: this.messageID,
        type: "message",
        role: "assistant",
        content: [],
        model: this.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  ensureThinking() {
    if (this.thinkingIndex !== null) return this.thinkingIndex;
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.thinkingIndex = index;
    this.thinkingHasContent = false;
    writeEvent(this.response, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "thinking", thinking: "", signature: "" },
    });
    return index;
  }

  appendThinking(delta) {
    const index = this.ensureThinking();
    writeEvent(this.response, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "thinking_delta", thinking: delta },
    });
    this.thinkingHasContent = true;
  }

  writeReasoning(delta) {
    if (typeof delta !== "string" || delta.length === 0) return;
    const separator = this.reasoningNeedsSeparator && this.thinkingHasContent
      ? "\n\n"
      : "";
    this.appendThinking(`${separator}${delta}`);
    this.reasoningNeedsSeparator = false;
  }

  writeStatus(status) {
    if (typeof status !== "string" || status.length === 0) return;
    this.appendThinking(`${this.thinkingHasContent ? "\n\n" : ""}${status}`);
    this.reasoningNeedsSeparator = true;
  }

  stopThinking() {
    if (this.thinkingIndex === null) return;
    const index = this.thinkingIndex;
    writeEvent(this.response, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: {
        type: "signature_delta",
        signature: "dia-custom-local-summary-v1",
      },
    });
    writeEvent(this.response, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
    this.thinkingIndex = null;
    this.thinkingHasContent = false;
    this.reasoningNeedsSeparator = false;
  }

  writeLocalToolUse(call) {
    this.stopThinking();
    const activity = localActivity(call);
    this.localActivities.set(call.id, activity);
    const index = this.nextIndex;
    this.nextIndex += 1;
    writeEvent(this.response, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: {
        type: "server_tool_use",
        id: activity.id,
        name: activity.name,
      },
    });
    writeEvent(this.response, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(activity.input),
      },
    });
    writeEvent(this.response, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  }

  writeLocalToolResult(call, result) {
    this.stopThinking();
    const activity = this.localActivities.get(call.id) ?? localActivity(call);
    const index = this.nextIndex;
    this.nextIndex += 1;
    writeEvent(this.response, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: serverToolResult(activity, result),
    });
    writeEvent(this.response, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  }

  writeText(text) {
    this.stopThinking();
    const index = this.nextIndex;
    this.nextIndex += 1;
    writeEvent(this.response, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    });
    writeEvent(this.response, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    });
    writeEvent(this.response, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  }

  startNativeToolCall(call) {
    if (!call?.id || this.nativeToolStreams.has(call.id)) return;
    this.stopThinking();
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.nativeToolStreams.set(call.id, index);
    writeEvent(this.response, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: {
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: {},
      },
    });
  }

  writeNativeToolInput(id, partialJSON) {
    const index = this.nativeToolStreams.get(id);
    if (index === undefined || typeof partialJSON !== "string" || !partialJSON) return;
    writeEvent(this.response, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: partialJSON },
    });
  }

  finishNativeToolCall(id) {
    const index = this.nativeToolStreams.get(id);
    if (index === undefined) return;
    writeEvent(this.response, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
    this.nativeToolStreams.delete(id);
  }

  hasNativeToolStream(id) {
    return this.nativeToolStreams.has(id);
  }

  writeNativeToolCalls(toolCalls) {
    for (const toolCall of toolCalls) this.writeStatus(nativeToolStatus(toolCall));
    this.stopThinking();
    for (const toolCall of toolCalls) {
      this.startNativeToolCall(toolCall);
      this.writeNativeToolInput(toolCall.id, JSON.stringify(toolCall.input ?? {}));
      this.finishNativeToolCall(toolCall.id);
    }
  }

  finish({ stopReason, outputTokens = 0 }) {
    this.stopThinking();
    writeEvent(this.response, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });
    writeEvent(this.response, "message_stop", { type: "message_stop" });
    this.response.end();
  }
}

export { localActivity, serverToolResult, visibleToolResult };
