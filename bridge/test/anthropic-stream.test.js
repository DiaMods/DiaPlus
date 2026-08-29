import assert from "node:assert/strict";
import test from "node:test";
import { AnthropicStreamWriter } from "../src/anthropic-stream.js";

function responseRecorder() {
  let output = "";
  return {
    response: {
      write(value) { output += value; },
      end() {},
    },
    events() {
      return output.split("\n\n").filter(Boolean).map((frame) => {
        const lines = frame.split("\n");
        return {
          event: lines[0].slice("event: ".length),
          data: JSON.parse(lines[1].slice("data: ".length)),
        };
      });
    },
  };
}

test("reasoning deltas preserve token spacing and local tools become server activity", () => {
  const recorder = responseRecorder();
  const stream = new AnthropicStreamWriter(recorder.response, {
    messageID: "message-1",
    model: "rchat:gemma4:e4b",
  });
  stream.startMessage();
  stream.writeStatus("Reviewing tools...");
  stream.writeReasoning("Discord");
  stream.writeReasoning(" changed");
  stream.writeLocalToolUse({ id: "call-1", name: "mcp__dia-tools__search_web", input: { query: "Discord" } });
  stream.writeLocalToolResult({ id: "call-1" }, { results: [{ title: "Discord" }] });
  stream.writeStatus("Reviewing results...");
  stream.writeNativeToolCalls([{ id: "call-2", name: "mcp__dia-tools__fetch_web_content", input: { urls: ["https://example.com"] } }]);
  stream.writeText("Discord changed its overlay.");
  stream.finish({ stopReason: "end_turn" });

  const events = recorder.events();
  const thinking = events
    .filter((entry) => entry.data?.delta?.type === "thinking_delta")
    .map((entry) => entry.data.delta.thinking)
    .join("");
  assert.equal(thinking, "Reviewing tools...\n\nDiscord changedReviewing results...\n\nReading web sources...");
  assert.equal(events.find((entry) => entry.data?.content_block?.type === "server_tool_use")
    .data.content_block.name, "web_search");
  assert.equal(events.find((entry) => entry.data?.content_block?.type === "web_search_tool_result")
    .data.content_block.tool_use_id, "srvtoolu_dia_custom_call-1");
  const indexes = events
    .filter((entry) => entry.event === "content_block_start")
    .map((entry) => entry.data.index);
  assert.deepEqual(indexes, [0, 1, 2, 3, 4, 5]);
});

test("native Report Write input can stream top-down before the tool block closes", () => {
  const recorder = responseRecorder();
  const stream = new AnthropicStreamWriter(recorder.response, {
    messageID: "message-report",
    model: "rchat:gemma4:e4b",
  });
  stream.startMessage();
  stream.writeStatus("Generating the Report in Dia...");
  stream.startNativeToolCall({ id: "write-report", name: "Write" });
  stream.writeNativeToolInput(
    "write-report",
    '{"file_path":"/context/work/artifacts/report/index.html","content":"<!DOCTYPE html>\\n',
  );
  stream.writeNativeToolInput(
    "write-report",
    '<head><link rel=\\"stylesheet\\" href=\\"style.css\\"></head>',
  );
  assert.equal(stream.hasNativeToolStream("write-report"), true);
  stream.writeNativeToolInput("write-report", '"}');
  stream.finishNativeToolCall("write-report");
  stream.finish({ stopReason: "tool_use" });

  const events = recorder.events();
  const start = events.find((entry) => entry.data?.content_block?.id === "write-report");
  assert.equal(start.data.content_block.name, "Write");
  const input = events
    .filter((entry) => entry.data?.index === start.data.index &&
      entry.data?.delta?.type === "input_json_delta")
    .map((entry) => entry.data.delta.partial_json)
    .join("");
  assert.deepEqual(JSON.parse(input), {
    file_path: "/context/work/artifacts/report/index.html",
    content: '<!DOCTYPE html>\n<head><link rel="stylesheet" href="style.css"></head>',
  });
  assert.equal(stream.hasNativeToolStream("write-report"), false);
});

test("final text deltas share one native Dia text block", () => {
  const recorder = responseRecorder();
  const stream = new AnthropicStreamWriter(recorder.response, {
    messageID: "message-stream",
    model: "ollama:qwen",
  });
  stream.startMessage();
  stream.appendText("First ");
  stream.appendText("second.");
  stream.finish({ stopReason: "end_turn" });
  const events = recorder.events();
  assert.equal(events.filter((entry) => entry.data?.content_block?.type === "text").length, 1);
  assert.equal(events.filter((entry) => entry.data?.delta?.type === "text_delta")
    .map((entry) => entry.data.delta.text).join(""), "First second.");
});
