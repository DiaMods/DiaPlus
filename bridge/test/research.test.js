import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { ProviderManager } from "../src/provider-manager.js";

test("research uses the selected provider, local read-only tools, source citations and the profile's knowledge store", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-research-"));
  const executed = [];
  const config = { selectedModel: "fixture:test", providers: [{ id: "fixture", enabled: true, type: "codex" }],
    localMemory: { enabled: false }, localWeb: { enabled: false }, localConnectors: { enabled: true } };
  const manager = new ProviderManager({ configStore: { load: async () => config }, memoryStore: { path: resolve(directory, "unused.sqlite") },
    toolCoverageStore: { record: async () => {} },
    connectorRegistry: {
      observeNativeToolResults: async () => {}, observeNativeTools: async () => {},
      definitions: async () => [{ name: "mcp__custom_fixture__read", source: "local", annotations: { readOnlyHint: true }, input_schema: { type: "object" } },
        { name: "mcp__custom_fixture__send", source: "local", annotations: { readOnlyHint: false }, input_schema: { type: "object" } }],
      isTool: (name) => name.startsWith("mcp__custom_fixture__"),
      execute: async (name, _input, context) => { executed.push({ name, context }); return { content: [{ type: "text", text: JSON.stringify({ url: "https://example.com/release", content: "Cobalt released September 7." }) }] }; },
    },
  });
  t.after(async () => { manager.workflows.stop(); await manager.workflows.waitForIdle(); manager.knowledgeStore.close(); await rm(directory, { recursive: true, force: true }); });
  let rounds = 0;
  manager.runProvider = async (_provider, { tools, payload }) => {
    assert.ok(tools.every((tool) => tool.source === "local" && tool.annotations?.readOnlyHint === true));
    assert.ok(!tools.some((tool) => tool.name.endsWith("__send") || tool.name === "ToolSearch"));
    assert.equal(payload.metadata.profileID, "Work");
    rounds += 1;
    if (rounds === 1) return { kind: "tool_use", text: "", toolCalls: [{ id: "read-1", name: "mcp__custom_fixture__read", input: {} }] };
    return { kind: "final", text: "Cobalt released September 7. [Release notes](https://example.com/release)", toolCalls: [] };
  };
  const { job } = await manager.workflows.research({ profileID: "Work", title: "Cobalt research", prompt: "Find evidence of Cobalt's release date" });
  await manager.workflows.waitForIdle();
  assert.equal(executed.length, 1);
  assert.equal(executed[0].context.profileID, "Work");
  assert.equal(executed[0].context.readOnlyLocalOnly, true);
  const finished = (await manager.workflows.runs({ profileID: "Work" })).runs.find((run) => run.id === job.id);
  assert.equal(finished.status, "succeeded");
  const document = (await manager.knowledgeStore.read({ profileID: "Work", ids: [finished.documentID] })).documents[0];
  assert.match(document.content, /\[Release notes\]\(https:\/\/example.com\/release\)/);
  assert.deepEqual(document.provenance.sources, ["https://example.com/release"]);
  assert.equal((await manager.knowledgeStore.list({ profileID: "Default" })).documents.length, 0);
});
