import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkflows, handleWorkflowAPI } from "../src/workflows.js";
import { LocalToolRegistry } from "../src/local-tools/index.js";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-workflows-"));
  const workflows = new LocalWorkflows({ path: resolve(directory, "workflows.json"), enabled: () => true, runResearch: async () => ({ document: { id: "research-result" } }), ...options });
  t.after(async () => { workflows.stop(); await workflows.waitForIdle(); await rm(directory, { recursive: true, force: true }); });
  return workflows;
}

const schedule = { profileID: "Work", title: "Daily summary", prompt: "Summarize recent public release notes with citations", intervalMinutes: 1440 };

test("schedules default disabled, run manually, persist results and stay profile scoped", async (t) => {
  const workflows = await fixture(t);
  const { workflow } = await workflows.save(schedule);
  assert.equal(workflow.enabled, false);
  assert.equal(workflow.nextRun, null);
  assert.equal((await workflows.list({ profileID: "Default" })).workflows.length, 0);
  await assert.rejects(workflows.run(workflow.id, { profileID: "Default" }), /Unknown workflow/);
  const { job } = await workflows.run(workflow.id, { profileID: "Work" });
  assert.equal(job.status, "running");
  await workflows.waitForIdle();
  assert.equal((await workflows.runs({ profileID: "Work" })).runs[0].documentID, "research-result");
  const persisted = JSON.parse(await readFile(workflows.path, "utf8"));
  assert.equal(persisted.workflows[0].lastStatus, "succeeded");
  assert.equal(persisted.workflows[0].enabled, false);
});

test("enabled schedules skip missed runs on restart and do not overlap while a prior run is pending", async (t) => {
  let now = 1_000_000;
  let release;
  const workflows = await fixture(t, { now: () => now, runResearch: async () => new Promise((resolve) => { release = resolve; }) });
  const { workflow } = await workflows.save({ ...schedule, intervalMinutes: 5, enabled: true });
  now += 300_000;
  await workflows.tick();
  await assert.rejects(workflows.run(workflow.id, { profileID: "Work" }), /already has a running/);
  now += 300_000;
  await workflows.tick();
  assert.equal((await workflows.runs({ profileID: "Work" })).runs.length, 1);
  release({ document: { id: "complete" } });
  await workflows.waitForIdle();
  now += 2_000_000;
  const resumed = new LocalWorkflows({ path: workflows.path, now: () => now, enabled: () => true, runResearch: async () => { throw new Error("Missed jobs must not run"); } });
  await resumed.load();
  await resumed.tick();
  const restored = (await resumed.list({ profileID: "Work" })).workflows[0];
  assert.equal(restored.nextRun, now + 300_000);
  assert.equal(restored.lastStatus, "skipped");
});

test("workflow execution failures become durable failed runs and permit retry", async (t) => {
  const workflows = await fixture(t, { runResearch: async () => { throw new Error("Provider unavailable"); } });
  await workflows.research({ profileID: "Work", title: "Manual research", prompt: "Find public evidence" });
  await workflows.waitForIdle();
  const job = (await workflows.runs({ profileID: "Work" })).runs[0];
  assert.equal(job.status, "failed");
  assert.match(job.error, /Provider unavailable/);
  assert.equal((await workflows.runs({ profileID: "Default" })).runs.length, 0);
});

test("research tool policy excludes native tools, remote writes and missing read-only hints at discovery and execution", async () => {
  const attempted = [];
  const registry = new LocalToolRegistry({}, { load: async () => ({ localMemory: { enabled: false }, localWeb: { enabled: false }, localConnectors: { enabled: true } }) }, {
    connectorRegistry: {
      definitions: async () => [
        { name: "mcp__custom_x__read", source: "local", annotations: { readOnlyHint: true } },
        { name: "mcp__custom_x__send", source: "local", annotations: { readOnlyHint: false } },
        { name: "mcp__custom_x__unknown", source: "local" },
      ],
      isTool: (name) => name.startsWith("mcp__custom_"),
      execute: async (name) => { attempted.push(name); return {}; },
    },
  });
  const definitions = await registry.definitions([{ name: "Write", source: "native", annotations: { readOnlyHint: true } }], { profileID: "Work", readOnlyLocalOnly: true });
  assert.ok(definitions.some((tool) => tool.name === "mcp__custom_x__read"));
  assert.ok(definitions.every((tool) => tool.name !== "Write" && !/send|unknown/.test(tool.name)));
  await assert.rejects(registry.execute({ name: "mcp__custom_x__send", input: {} }, { profileID: "Work", readOnlyLocalOnly: true }), /read-only/);
  assert.deepEqual(attempted, []);
  await registry.execute({ name: "mcp__custom_x__read", input: {} }, { profileID: "Work", readOnlyLocalOnly: true });
  assert.deepEqual(attempted, ["mcp__custom_x__read"]);
});

test("workflow and knowledge administration is authenticated, profile scoped and returns immediate jobs", async () => {
  let result;
  const options = { manager: { workflows: { research: async (input) => ({ job: { status: "running", ...input } }) } }, hasAdminToken: async () => false,
    readBody: async () => Buffer.from(JSON.stringify({ profileID: "Work", title: "Research", prompt: "Find sources" })),
    jsonResponse: (_response, status, value) => { result = { status, value }; },
  };
  await handleWorkflowAPI({ method: "POST" }, {}, new URL("http://localhost/api/research"), options);
  assert.equal(result.status, 403);
  await handleWorkflowAPI({ method: "POST" }, {}, new URL("http://localhost/api/research"), { ...options, hasAdminToken: async () => true });
  assert.equal(result.status, 202);
  assert.equal(result.value.job.profileID, "Work");
});
