import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { ToolCoverageStore } from "../src/tool-coverage.js";

test("concurrent coverage records retain every chat and background request on disk", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-tool-coverage-"));
  try {
    const path = resolve(directory, "tools.json");
    const store = new ToolCoverageStore(path);
    await Promise.all(Array.from({ length: 20 }, (_, index) => {
      const tool = { name: `tool_${index}`, source: "native", input_schema: { type: "object" } };
      return store.record([tool], [tool]);
    }));
    assert.equal((await store.publicValue()).native, 20);
    assert.equal(Object.keys(JSON.parse(await readFile(path, "utf8")).tools).length, 20);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a deferred observation retains the last real schema for the coverage dashboard", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-tool-coverage-"));
  try {
    const store = new ToolCoverageStore(resolve(directory, "tools.json"));
    const loaded = {
      name: "open_tabs", source: "native", description: "Open browser tabs",
      input_schema: { type: "object", properties: { urls: { type: "array" } }, required: ["urls"] },
    };
    const initial = (await store.record([loaded], [loaded])).tools[0];
    const result = await store.record([{
      name: "open_tabs", source: "deferred", description: "Schema is loaded on demand",
      input_schema: { type: "object", properties: {} },
    }], []);
    assert.equal(result.deferred, 1);
    assert.deepEqual(result.tools[0].inputSchema, loaded.input_schema);
    assert.equal(result.tools[0].description, loaded.description);
    assert.equal(result.tools[0].schemaHash, initial.schemaHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
