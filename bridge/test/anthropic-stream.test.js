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
