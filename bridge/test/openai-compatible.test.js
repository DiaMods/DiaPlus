import assert from "node:assert/strict";
import test from "node:test";
import { runOpenAICompatibleProvider } from "../src/providers/openai-compatible.js";

const payload = {
  system: "Use browser tools when needed.",
  messages: [{ role: "user", content: "Open example.com" }],
};
const tools = [{
  name: "open_tabs",
  description: "Open browser tabs",
  input_schema: {
    type: "object",
    properties: { urls: { type: "array", items: { type: "string" } } },
    required: ["urls"],
  },
}];

function sseResponse(events) {
  return new Response(`${events.map(({ event, data }) =>
    `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("OpenAI-compatible chat completions stream reasoning and native tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const reasoning = [];
  const startedTools = [];
  const toolInput = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:11434/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "qwen3:8b");
    assert.equal(body.tools[0].function.name, "open_tabs");
    return sseResponse([
      { data: { choices: [{ delta: { reasoning_content: "Choosing a browser action." } }] } },
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "open_", arguments: "" } }] } }] } },
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "tabs", arguments: "{\"urls\":[\"https://example.com\"]}" } }] } }] } },
      { data: { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 4 } } },
    ]);
  };
  try {
    const result = await runOpenAICompatibleProvider({
      provider: { api: "chat-completions", baseURL: "http://127.0.0.1:11434/v1", label: "Ollama", apiKeyEnv: null },
      payload,
      tools,
      model: "qwen3:8b",
      onReasoning: (value) => reasoning.push(value),
      onToolStart: (call) => startedTools.push(call.name),
      onToolInputDelta: (call) => toolInput.push(call),
    });
    assert.equal(result.kind, "tool_use");
    assert.deepEqual(result.toolCalls[0].input, { urls: ["https://example.com"] });
    assert.match(reasoning.join(""), /browser action/);
    assert.deepEqual(startedTools, ["open_tabs"]);
    assert.equal(toolInput.at(-1).accumulated, '{"urls":["https://example.com"]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI-compatible chat completions make completed tool results explicit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages.slice(-2), [
      { role: "tool", tool_call_id: "call_1", content: "search result" },
      {
        role: "user",
        content: "The preceding tool call completed. Use its exact result below now.\nDo not claim it is pending or unavailable, and do not repeat the same call; request another tool only if this completed result is genuinely insufficient.\n<completed-tool-result>\nsearch result\n</completed-tool-result>",
      },
    ]);
    return sseResponse([{ data: { choices: [{ delta: { content: "Completed answer" } }] } }]);
  };
  try {
    const result = await runOpenAICompatibleProvider({
      provider: { api: "chat-completions", baseURL: "http://127.0.0.1:11434/v1", label: "Ollama", apiKeyEnv: null },
      payload: {
        ...payload,
        messages: [
          { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "open_tabs", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "search result" }] },
        ],
      },
      tools,
      model: "qwen3:8b",
    });
    assert.equal(result.text, "Completed answer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI Responses API stream maps output and reasoning summaries", async () => {
  const originalFetch = globalThis.fetch;
  const reasoning = [];
  const textDeltas = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(options.headers.authorization, "Bearer test-key");
    return sseResponse([
      { event: "response.reasoning_summary_text.delta", data: { type: "response.reasoning_summary_text.delta", delta: "Checking context." } },
      { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Done" } },
      { event: "response.completed", data: { type: "response.completed", response: { usage: { input_tokens: 8, output_tokens: 2 } } } },
    ]);
  };
  try {
    const result = await runOpenAICompatibleProvider({
      provider: { api: "responses", baseURL: "https://api.openai.com/v1", label: "OpenAI", apiKeyEnv: "DIA_CUSTOM_TEST_OPENAI_KEY" },
      apiKey: "test-key",
      payload,
      tools: [],
      model: "gpt-test",
      onReasoning: (value) => reasoning.push(value),
      onTextDelta: (value) => textDeltas.push(value),
    });
    assert.equal(result.kind, "final");
    assert.equal(result.text, "Done");
    assert.equal(result.usage.output_tokens, 2);
    assert.deepEqual(reasoning, ["Checking context."]);
    assert.deepEqual(textDeltas, ["Done"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI Responses API stream maps function calls back to Dia tools", async () => {
  const originalFetch = globalThis.fetch;
  const startedTools = [];
  const toolInput = [];
  globalThis.fetch = async () => sseResponse([
    {
      event: "response.output_item.added",
      data: {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "open_tabs", arguments: "" },
      },
    },
    {
      event: "response.function_call_arguments.delta",
      data: {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        call_id: "call_1",
        delta: "{\"urls\":[\"https://example.com\"]}",
      },
    },
    {
      event: "response.function_call_arguments.done",
      data: {
        type: "response.function_call_arguments.done",
        output_index: 0,
        call_id: "call_1",
        name: "open_tabs",
        arguments: "{\"urls\":[\"https://example.com\"]}",
      },
    },
    { event: "response.completed", data: { type: "response.completed", response: { usage: {} } } },
  ]);
  try {
    const result = await runOpenAICompatibleProvider({
      provider: { api: "responses", baseURL: "https://api.openai.com/v1", label: "OpenAI", apiKeyEnv: null },
      payload,
      tools,
      model: "gpt-test",
      onToolStart: (call) => startedTools.push(call.name),
      onToolInputDelta: (call) => toolInput.push(call),
    });
    assert.equal(result.kind, "tool_use");
    assert.equal(result.toolCalls[0].name, "open_tabs");
    assert.deepEqual(result.toolCalls[0].input, { urls: ["https://example.com"] });
    assert.deepEqual(startedTools, ["open_tabs"]);
    assert.equal(toolInput.at(-1).accumulated, '{"urls":["https://example.com"]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const api of ["chat-completions", "responses"]) {
  test(`${api} preserves image attachments and their position beside user text`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const messages = api === "responses" ? body.input : body.messages;
      assert.deepEqual(messages.at(-1), { role: "user", content: api === "responses" ? [
        { type: "input_text", text: "Compare these images" },
        { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=", detail: "auto" },
        { type: "input_text", text: "with this reference" },
        { type: "input_image", image_url: "https://example.com/reference.jpg", detail: "auto" },
      ] : [
        { type: "text", text: "Compare these images" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        { type: "text", text: "with this reference" },
        { type: "image_url", image_url: { url: "https://example.com/reference.jpg" } },
      ] });
      return sseResponse([]);
    };
    try {
      await runOpenAICompatibleProvider({
        provider: { api, baseURL: "https://example.com/v1", label: "Vision provider" },
        payload: { messages: [{ role: "user", content: [
          { type: "text", text: "Compare these images" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
          { type: "text", text: "with this reference" },
          { type: "image", source: { type: "url", url: "https://example.com/reference.jpg" } },
        ] }] },
        tools: [], model: "vision-test",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${api} retains tool error flags and renders images after all pending results`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const messages = api === "responses" ? body.input : body.messages;
      const results = messages.filter((message) => message.role === "tool" || message.type === "function_call_output");
      assert.equal(results.length, 2);
      assert.match(results[0].content ?? results[0].output, /^\[Tool execution failed\]/);
      assert.ok(messages.indexOf(results[1]) < messages.findIndex((message) => message.role === "user"));
      const attachment = messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
        .find((part) => ["input_image", "image_url"].includes(part.type));
      assert.equal(typeof attachment.image_url === "string" ? attachment.image_url : attachment.image_url.url,
        "data:image/jpeg;base64,aGVsbG8=");
      assert.ok(!String(results[1].content ?? results[1].output).includes("aGVsbG8="));
      return sseResponse([]);
    };
    try {
      await runOpenAICompatibleProvider({
        provider: { api, baseURL: "https://example.com/v1", label: "Vision provider" },
        payload: { messages: [
          { role: "assistant", content: [
            { type: "tool_use", id: "first", name: "read_tabs", input: {} },
            { type: "tool_use", id: "second", name: "Read", input: {} },
          ] },
          { role: "user", content: [
            { type: "text", text: "Use what you could retrieve." },
            { type: "tool_result", tool_use_id: "first", is_error: true, content: "No longer available." },
            { type: "tool_result", tool_use_id: "second", content: [
              { type: "text", text: "Screenshot" },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } },
            ] },
          ] },
        ] },
        tools: [], model: "vision-test",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${api} rejects blocked image destinations and invalid PDFs before sending`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { assert.fail("Invalid attachment must not be sent to a provider"); };
    try {
      for (const block of [
        { type: "image", source: { type: "url", url: "https://api.diabrowser.com/image.png" } },
        { type: "image", source: { type: "url", url: "https://user:secret@example.com/image.png" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
      ]) {
        await assert.rejects(runOpenAICompatibleProvider({
          provider: { api, baseURL: "https://example.com/v1", label: "Vision provider" },
          payload: { messages: [{ role: "user", content: [block] }] },
          tools: [], model: "vision-test",
        }), /refuses provider traffic|cannot contain credentials|cannot translate/i);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${api} surfaces streaming API errors instead of completing with an empty answer`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseResponse([
      { data: { ...(api === "responses" ? { type: "error" } : {}), error: { message: "Provider quota exceeded" } } },
    ]);
    try {
      await assert.rejects(runOpenAICompatibleProvider({
        provider: { api, baseURL: "https://example.com/v1", label: "Test provider" },
        payload, tools: [], model: "test",
      }), /Provider quota exceeded/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("Responses reports token-limited incomplete output as an error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sseResponse([
    { data: { type: "response.output_text.delta", delta: "Partial answer" } },
    { data: { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } } },
  ]);
  try {
    await assert.rejects(runOpenAICompatibleProvider({
      provider: { api: "responses", baseURL: "https://example.com/v1", label: "Test provider" },
      payload, tools: [], model: "test",
    }), /incomplete: max_output_tokens/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
