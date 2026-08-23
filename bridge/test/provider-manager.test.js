import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { ConfigStore } from "../src/config.js";
import { MemoryStore } from "../src/local-tools/memory.js";
import { ProviderManager } from "../src/provider-manager.js";

test("provider catalog discovers Ollama and routes local memory before native tools", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-manager-"));
  const config = new ConfigStore(resolve(directory, "config.json"));
  const memory = new MemoryStore(resolve(directory, "memory.sqlite3"), null);
  const manager = new ProviderManager({
    configStore: config,
    memoryStore: memory,
    catalogPath: resolve(directory, "models.json"),
    appleStatusImplementation: async () => ({
      onDevice: { available: true },
      privateCloud: { available: false, reason: "not eligible" },
    }),
    fetchImplementation: async (url) => {
      if (String(url).includes("127.0.0.1:11434")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), { status: 200 });
      }
      throw new Error("offline test");
    },
  });
  await manager.initialize();
  const catalog = await manager.publicCatalog();
  assert.ok(catalog.models.some((model) => model.key === "ollama:qwen3:8b"));
  assert.equal(catalog.models.find((model) => model.key === "apple-private-cloud:default").available, false);

  await memory.recordConversation({
    messages: [{ role: "user", content: "The local codeword is marigold." }],
  }, { kind: "final", text: "Stored locally." });

  let calls = 0;
  manager.runProvider = async (_provider, { payload }) => {
    calls += 1;
    if (calls === 1) {
      return {
        kind: "tool_use",
        text: "",
        toolCalls: [{
          id: "memory_call",
          name: "mcp__dia-tools__memory_search",
          input: { query: "marigold" },
        }],
        model: "gpt-5.6-luna",
      };
    }
    const last = payload.messages.at(-1);
    assert.equal(last.content[0].type, "tool_result");
    assert.match(last.content[0].content, /marigold/i);
    return { kind: "final", text: "The codeword was marigold.", toolCalls: [], model: "gpt-5.6-luna" };
  };
  const { result, nativeToolCount, totalToolCount } = await manager.run({
    messages: [{ role: "user", content: "What was the local codeword?" }],
    tools: [{ name: "open_tabs", description: "Open tabs", input_schema: { type: "object", properties: {} } }],
  });
  assert.equal(result.text, "The codeword was marigold.");
  assert.equal(calls, 2);
  assert.equal(nativeToolCount, 1);
  assert.equal(totalToolCount, 3);
  memory.database.close();
});
