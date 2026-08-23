import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { ConfigStore } from "../src/config.js";
import { CredentialStore } from "../src/credentials.js";
import { reportWorkflowState } from "../src/chat-shape.js";
import { MemoryStore } from "../src/local-tools/memory.js";
import { ProviderManager } from "../src/provider-manager.js";
import { ToolCoverageStore } from "../src/tool-coverage.js";

test("provider catalog discovers Ollama and routes local memory before native tools", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-manager-"));
  const config = new ConfigStore(resolve(directory, "config.json"));
  const memory = new MemoryStore(resolve(directory, "memory.sqlite3"), null);
  const manager = new ProviderManager({
    configStore: config,
    credentialStore: new CredentialStore(resolve(directory, "credentials.json")),
    memoryStore: memory,
    catalogPath: resolve(directory, "models.json"),
    toolCoverageStore: new ToolCoverageStore(resolve(directory, "tool-coverage.json")),
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
    tools: [
      { name: "open_tabs", description: "Open tabs", input_schema: { type: "object", properties: {} } },
      { name: "search_dia_product_knowledge", description: "Search Dia", input_schema: { type: "object", properties: {} } },
    ],
  });
  assert.equal(result.text, "The codeword was marigold.");
  assert.equal(calls, 2);
  assert.equal(nativeToolCount, 1);
  assert.equal(totalToolCount, 9);
  const coverage = await manager.toolCoverageStore.publicValue();
  assert.equal(coverage.tools.find((tool) => tool.name === "open_tabs").route, "native");
  assert.equal(coverage.tools.find((tool) =>
    tool.name === "mcp__dia-tools__search_web").route, "local");
  assert.equal(coverage.tools.find((tool) =>
    tool.name === "search_dia_product_knowledge").route, "blocked");
  assert.equal(coverage.blocked, 1);
  memory.database.close();
});

test("local memory toggle controls tools, retrieval, and future chat capture", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-memory-toggle-"));
  const config = new ConfigStore(resolve(directory, "config.json"));
  const memory = new MemoryStore(resolve(directory, "memory.sqlite3"), null);
  const manager = new ProviderManager({
    configStore: config,
    credentialStore: new CredentialStore(resolve(directory, "credentials.json")),
    memoryStore: memory,
    catalogPath: resolve(directory, "models.json"),
    toolCoverageStore: new ToolCoverageStore(resolve(directory, "tool-coverage.json")),
    appleStatusImplementation: async () => ({
      onDevice: { available: false, reason: "test" },
      privateCloud: { available: false, reason: "test" },
    }),
    fetchImplementation: async () => { throw new Error("offline test"); },
  });
  await manager.initialize();

  const presentedTools = [];
  let releaseInFlight;
  let enteredInFlight;
  const inFlightEntered = new Promise((resolve) => { enteredInFlight = resolve; });
  manager.runProvider = async (_provider, { tools, payload }) => {
    presentedTools.push(tools.map((tool) => tool.name));
    if (JSON.stringify(payload.messages).includes("in-flight-disable-marker")) {
      enteredInFlight();
      await new Promise((resolve) => { releaseInFlight = resolve; });
    }
    return {
      kind: "final",
      text: "Captured only when local memory is enabled.",
      toolCalls: [],
      model: "gpt-5.6-luna",
    };
  };
  const run = (marker) => manager.run({
    messages: [{ role: "user", content: marker }],
    tools: [],
  });

  await run("enabled-memory-marker");
  assert.ok(presentedTools.at(-1).includes("mcp__dia-tools__memory_search"));
  const enabledCount = (await memory.stats()).total;
  assert.ok(enabledCount > 0);

  const inFlightRun = run("in-flight-disable-marker");
  await inFlightEntered;
  assert.equal((await manager.setLocalMemoryEnabled(false)).enabled, false);
  releaseInFlight();
  await inFlightRun;
  assert.ok(presentedTools.at(-1).includes("mcp__dia-tools__memory_search"));
  assert.equal((await memory.stats()).total, enabledCount);

  await run("disabled-memory-marker");
  assert.equal(presentedTools.at(-1).includes("mcp__dia-tools__memory_search"), false);
  assert.equal((await memory.stats()).total, enabledCount);
  await assert.rejects(
    manager.localTools.execute({
      name: "mcp__dia-tools__memory_search",
      input: { query: "enabled-memory-marker" },
    }),
    /local memory is disabled/,
  );

  assert.equal((await manager.setLocalMemoryEnabled(true)).enabled, true);
  await run("re-enabled-memory-marker");
  assert.ok((await memory.stats()).total > enabledCount);

  const retention = await manager.setLocalMemoryRetention(7);
  assert.equal(retention.localMemory.retentionDays, 7);
  assert.equal(retention.stats.total, (await memory.stats()).total);
  await assert.rejects(() => manager.setLocalMemoryRetention(-1), /retentionDays/);
  memory.database.close();
});

test("Report requests reject premature uploads, normalize Write paths, and upload", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-report-manager-"));
  const config = new ConfigStore(resolve(directory, "config.json"));
  const current = await config.load();
  await config.update({
    ...current,
    localMemory: { enabled: false, importBrowserHistory: false, captureChats: false },
    localWeb: { enabled: false },
    localConnectors: { enabled: false },
  });
  const memory = new MemoryStore(resolve(directory, "memory.sqlite3"), null);
  const manager = new ProviderManager({
    configStore: config,
    credentialStore: new CredentialStore(resolve(directory, "credentials.json")),
    memoryStore: memory,
    catalogPath: resolve(directory, "models.json"),
    toolCoverageStore: new ToolCoverageStore(resolve(directory, "tool-coverage.json")),
    appleStatusImplementation: async () => ({
      onDevice: { available: false, reason: "test" },
      privateCloud: { available: false, reason: "test" },
    }),
    fetchImplementation: async () => { throw new Error("offline test"); },
  });
  await manager.initialize();

  const contextWork = resolve(
    directory,
    "User Data/Default/AgentServer/contexts/E53B9BE3-F23C-4C0E-987B-30921F6BA109/work",
  );
  const payload = {
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: `<agent-context>\n<agent-id>agent-1</agent-id>\n<working-directory>${contextWork}</working-directory>\n</agent-context>\n<user-message>Create a report about Saturn</user-message>`,
      }],
    }],
    tools: [
      { name: "Skill", input_schema: { type: "object", properties: { skill: { type: "string" } } } },
      { name: "Write", input_schema: { type: "object", properties: { file_path: { type: "string" } } } },
      {
        name: "mcp__dia-tools__upload_artifact",
        input_schema: { type: "object", properties: { site_root: { type: "string" } } },
      },
    ],
  };

  let providerCalls = 0;
  manager.runProvider = async (_provider, { payload: providerPayload, tools }) => {
    providerCalls += 1;
    assert.match(JSON.stringify(providerPayload), /dia-custom-report-policy/);
    assert.deepEqual(tools.map((tool) => tool.name), ["Write"]);
    if (providerCalls === 1) {
      return {
        kind: "tool_use",
        text: "",
        toolCalls: [{
          id: "premature-upload",
          name: "mcp__dia-tools__upload_artifact",
          input: { site_root: "/tmp/missing-report", relative_path: "index.html" },
        }],
        model: "gpt-5.6-luna",
      };
    }
    return {
      kind: "tool_use",
      text: "",
      toolCalls: [{
        id: "write-report",
        name: "Write",
        input: { file_path: "/tmp/wrong-context/work/artifacts/saturn/index.html", content: "<html></html>" },
      }],
      model: "gpt-5.6-luna",
    };
  };

  const skillTurn = await manager.run(payload);
  assert.equal(providerCalls, 0);
  assert.deepEqual(skillTurn.result.toolCalls.map((call) => call.input.skill), [
    "artifact-generation",
    "report-kit",
  ]);
  payload.messages.push(
    {
      role: "assistant",
      content: skillTurn.result.toolCalls.map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    },
    {
      role: "user",
      content: skillTurn.result.toolCalls.map((call) => ({
        type: "tool_result",
        tool_use_id: call.id,
        content: "Launching skill",
      })),
    },
  );

  const writeTurn = await manager.run(payload);
  assert.equal(providerCalls, 2);
  assert.equal(writeTurn.result.toolCalls[0].name, "Write");
  const expectedReport = reportWorkflowState(payload);
  assert.equal(writeTurn.result.toolCalls[0].input.file_path, expectedReport.reportFilePath);
  payload.messages.push(
    {
      role: "assistant",
      content: writeTurn.result.toolCalls.map((call) => ({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    },
    {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: writeTurn.result.toolCalls[0].id,
        content: "File created successfully",
      }],
    },
  );

  const uploadTurn = await manager.run(payload);
  assert.equal(providerCalls, 2);
  assert.equal(uploadTurn.result.toolCalls[0].name, "mcp__dia-tools__upload_artifact");
  assert.deepEqual(uploadTurn.result.toolCalls[0].input, {
    site_root: expectedReport.reportDirectory,
    relative_path: "index.html",
  });
  memory.database.close();
});
