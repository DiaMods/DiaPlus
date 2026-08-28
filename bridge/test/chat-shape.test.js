import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecisionPrompt,
  buildExactToolGuide,
  deferredAnthropicTools,
  normalizeAnthropicTools,
  reportWorkflowRequiresTool,
  reportWorkflowState,
  removeRepeatedFailedToolCalls,
  toolDecisionSchemaForPayload,
  withReportWorkflowPolicy,
  stripLeadingProgressNarration,
  isToolContinuation,
  nativeToolSearchTool,
} from "../src/chat-shape.js";

const reportTools = [
  { name: "Skill", source: "native", input_schema: { type: "object", properties: {} } },
  { name: "Write", source: "native", input_schema: { type: "object", properties: {} } },
  {
    name: "mcp__dia-tools__upload_artifact",
    source: "native",
    input_schema: { type: "object", properties: { site_root: { type: "string" } } },
  },
];

test("exact tool guide maps Dia shorthand and requires native Report upload", () => {
  const guide = buildExactToolGuide(reportTools);
  assert.match(guide, /EXACT AVAILABLE TOOL NAMES.*mcp__dia-tools__upload_artifact/);
  assert.match(guide, /upload_artifact => mcp__dia-tools__upload_artifact/);
  assert.match(guide, /CURRENT Dia agent context's work\/artifacts/);
  assert.match(guide, /never reuse an artifact path/i);
  assert.match(buildExactToolGuide([{
    name: "mcp__dia-tools__connector_search",
  }]), /imported records, never as a currently synced account/);
  assert.match(guide, /not complete until the upload tool returns a successful result/i);
});

test("decision prompt places exact tool availability before the native payload", () => {
  const prompt = buildDecisionPrompt({
    system: "Create a Report with upload_artifact.",
    messages: [{ role: "user", content: "Make a Report" }],
  }, reportTools);
  assert.ok(prompt.indexOf("EXACT AVAILABLE TOOL NAMES") < prompt.indexOf("The transcript"));
  assert.match(prompt, /Every name in that list is currently callable/);
  assert.match(prompt, /Final text must begin with the completed answer/);
});

test("removes stale progress narration only when a completed answer follows", () => {
  assert.equal(
    stripLeadingProgressNarration("I’m gathering the latest information on Discord. Discord added a new overlay."),
    "Discord added a new overlay.",
  );
  assert.equal(
    stripLeadingProgressNarration("I’ve gathered the latest information. Discord added profile controls."),
    "Discord added profile controls.",
  );
  assert.equal(
    stripLeadingProgressNarration("Discord is gathering feedback. More changes are expected."),
    "Discord is gathering feedback. More changes are expected.",
  );
});

test("recognizes only an active native tool continuation", () => {
  assert.equal(isToolContinuation({
    messages: [{
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-1", content: "done" }],
    }],
  }), true);
  assert.equal(isToolContinuation({
    messages: [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "done" }] },
      { role: "user", content: "A new request" },
    ],
  }), false);
});

test("filters Dia-owned knowledge tools while retaining browser tools", () => {
  const tools = normalizeAnthropicTools({
    tools: [
      { name: "open_tabs" },
      { name: "search_dia_product_knowledge" },
      { name: "mcp__dia-tools__fetch_web_content" },
    ],
  });
  assert.deepEqual(tools.map((tool) => tool.name), [
    "open_tabs",
    "mcp__dia-tools__fetch_web_content",
  ]);
  assert.deepEqual(normalizeAnthropicTools({
    tools: [{ name: "search_dia_product_knowledge" }],
  }, { includeBlocked: true }).map((tool) => tool.name), [
    "search_dia_product_knowledge",
  ]);
});

test("inventories Dia's native on-demand tools and exposes their native schema loader", () => {
  const payload = {
    messages: [{
      role: "user",
      content: `<system-reminder>\nThe following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail. Use ToolSearch before calling them:\nTodoWrite\nmcp__dia-tools__open_tabs\nmcp__dia-tools__search_dia_product_knowledge\n</system-reminder>`,
    }],
  };
  const deferred = deferredAnthropicTools(payload);
  assert.deepEqual(deferred.map((tool) => [tool.name, tool.source]), [
    ["TodoWrite", "deferred"],
    ["mcp__dia-tools__open_tabs", "deferred"],
    ["mcp__dia-tools__search_dia_product_knowledge", "blocked"],
  ]);
  const toolSearch = nativeToolSearchTool(payload);
  assert.equal(toolSearch.name, "ToolSearch");
  assert.deepEqual(toolSearch.input_schema.required, ["query"]);
  assert.match(buildExactToolGuide([toolSearch]), /DEFERRED DIA TOOLS/);
  assert.equal(nativeToolSearchTool({ messages: [] }), null);
});

test("blocks an identical failed tool call until a new user request", () => {
  const failedPayload = {
    messages: [
      { role: "user", content: [{ type: "text", text: "<user-message>Make a report</user-message>" }] },
      { role: "assistant", content: [{
        type: "tool_use",
        id: "upload-1",
        name: "mcp__dia-tools__upload_artifact",
        input: { relative_path: "index.html", site_root: "/tmp/report" },
      }] },
      { role: "user", content: [{
        type: "tool_result",
        tool_use_id: "upload-1",
        content: '{"result":"The path is not within an allowed sandbox directory."}',
      }] },
    ],
  };
  const repeated = [{
    id: "upload-2",
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: "/tmp/report", relative_path: "index.html" },
  }];
  assert.equal(removeRepeatedFailedToolCalls(failedPayload, repeated).blocked.length, 1);

  failedPayload.messages.push({
    role: "user",
    content: [{ type: "text", text: "<user-message>Retry it now</user-message>" }],
  });
  assert.equal(removeRepeatedFailedToolCalls(failedPayload, repeated).blocked.length, 0);
});

test("tracks the native Report workflow through skills, Write, upload failure, and retry", () => {
  const payload = {
    messages: [{
      role: "user",
      content: [{ type: "text", text: "<user-message>Create a report about Saturn</user-message>" }],
    }],
  };
  assert.deepEqual(reportWorkflowState(payload).missingSkills, [
    "artifact-generation",
    "report-kit",
  ]);

  payload.messages.push(
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "skill-a", name: "Skill", input: { skill: "artifact-generation" } },
        { type: "tool_use", id: "skill-r", name: "Skill", input: { skill: "report-kit" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "skill-a", content: "Launching skill" },
        { type: "tool_result", tool_use_id: "skill-r", content: "Launching skill" },
      ],
    },
  );
  assert.equal(reportWorkflowState(payload).stage, "create_report");
  assert.deepEqual(toolDecisionSchemaForPayload(payload).properties.kind.enum, ["tool_use"]);
  assert.match(
    JSON.stringify(withReportWorkflowPolicy(payload, reportWorkflowState(payload))),
    /status update.*invalid/i,
  );

  const reportPath = "/tmp/context/work/artifacts/saturn/index.html";
  payload.messages.push(
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "write", name: "Write", input: { file_path: reportPath } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "write", content: "File created successfully" }],
    },
  );
  assert.deepEqual(reportWorkflowState(payload).uploadInput, {
    site_root: "/tmp/context/work/artifacts/saturn",
    relative_path: "index.html",
  });

  payload.messages.push(
    {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "upload-1",
        name: "mcp__dia-tools__upload_artifact",
        input: reportWorkflowState(payload).uploadInput,
      }],
    },
    {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "upload-1",
        content: '{"result":"Failed to save file: notAvailable"}',
      }],
    },
  );
  assert.equal(reportWorkflowState(payload).stage, "failed");
  payload.messages.push({
    role: "user",
    content: [{ type: "text", text: "<user-message>Try again</user-message>" }],
  });
  assert.equal(reportWorkflowState(payload).stage, "upload_report");

  payload.messages.push(
    {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "upload-2",
        name: "mcp__dia-tools__upload_artifact",
        input: reportWorkflowState(payload).uploadInput,
      }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "upload-2", content: '{"result":"report-123"}' }],
    },
  );
  assert.equal(reportWorkflowState(payload).stage, "complete");
});

test("pins a Report to a deterministic folder in the current agent context", () => {
  const work = "/tmp/profile/User Data/Default/AgentServer/contexts/E53B9BE3-F23C-4C0E-987B-30921F6BA109/work";
  const payload = {
    messages: [{
      role: "user",
      content: `<agent-context>\n<agent-id>agent-1</agent-id>\n<working-directory>${work}</working-directory>\n</agent-context>\n<user-message>Write a report about black holes</user-message>`,
    }],
  };
  const state = reportWorkflowState(payload);
  assert.equal(state.workingDirectory, work);
  assert.ok(state.reportDirectory.startsWith(`${work}/artifacts/black-holes-report-`));
  assert.match(state.reportDirectory, /-report-[a-f0-9]{8}$/);
  assert.equal(state.reportFilePath, `${state.reportDirectory}/index.html`);

  payload.messages.push(
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "skill-a", name: "Skill", input: { skill: "artifact-generation" } },
        { type: "tool_use", id: "skill-r", name: "Skill", input: { skill: "report-kit" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "skill-a", content: "Launching skill" },
        { type: "tool_result", tool_use_id: "skill-r", content: "Launching skill" },
      ],
    },
  );

  const writeOnly = [reportTools.find((tool) => tool.name === "Write")];
  assert.deepEqual(
    toolDecisionSchemaForPayload(payload, writeOnly)
      .properties.tool_calls.items.properties.name.enum,
    ["Write"],
  );

  payload.messages.push(
    {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "wrong-context-write",
        name: "Write",
        input: { file_path: "/tmp/other/work/artifacts/old/index.html" },
      }],
    },
    {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "wrong-context-write",
        content: "File created successfully",
      }],
    },
  );
  assert.equal(reportWorkflowState(payload).stage, "create_report");
});

test("does not hijack a report question or an unrelated later request", () => {
  assert.equal(reportWorkflowState({
    messages: [{ role: "user", content: "How do I make a report?" }],
  }).active, false);
  assert.equal(reportWorkflowState({
    messages: [
      { role: "user", content: "Create a report about Saturn" },
      { role: "assistant", content: "I will do that." },
      { role: "user", content: "What time is it?" },
    ],
  }).active, false);
});

test("does not enforce a chat Report inside background metadata requests", () => {
  const payload = {
    messages: [{ role: "user", content: "Create a report about Saturn" }],
  };
  const metadataTools = [{ name: "mcp__dia-tools__memory_search" }];
  assert.equal(reportWorkflowRequiresTool(payload, metadataTools), false);
  assert.deepEqual(
    toolDecisionSchemaForPayload(payload, metadataTools).properties.kind.enum,
    ["final", "tool_use"],
  );
});
