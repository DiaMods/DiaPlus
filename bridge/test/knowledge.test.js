import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { KnowledgeStore, executeKnowledgeTool } from "../src/knowledge.js";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-knowledge-"));
  const store = new KnowledgeStore(resolve(directory, "knowledge.sqlite3"), options);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return store;
}

test("knowledge import, search, full read and deletion preserve sources and isolate profiles", async (t) => {
  const store = await fixture(t);
  const imported = await store.import({ profileID: "Work", title: "Release research", content: "Verified Cobalt launch. [Source](https://example.com/release)", provenance: { kind: "research", sources: ["https://example.com/release"] } });
  const id = imported.document.id;
  assert.equal((await store.search({ profileID: "Work", query: "Cobalt" })).documents[0].id, id);
  assert.deepEqual((await store.read({ profileID: "Work", ids: [id] })).documents[0].provenance.sources, ["https://example.com/release"]);
  assert.equal((await store.read({ profileID: "Default", ids: [id] })).documents.length, 0);
  assert.equal((await executeKnowledgeTool(store, "mcp__dia-tools__knowledge_read", { ids: [id], profileID: "Work" }, { profileID: "Default" })).documents.length, 0);
  assert.equal((await store.remove({ profileID: "Default", id })).deleted, 0);
  assert.equal((await store.remove({ profileID: "Work", id })).deleted, 1);
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
});

test("URL imports use bounded public-web extraction and save retrieval provenance", async (t) => {
  const calls = [];
  const store = await fixture(t, { webTools: { fetchContent: async (input) => {
    calls.push(input); return { pages: [{ url: "https://example.com/final", title: "Page title", content: "Extracted public content", truncated: false }] };
  } } });
  const { document } = await store.import({ url: "https://example.com/start", profileID: "Work" });
  assert.deepEqual(calls, [{ urls: ["https://example.com/start"] }]);
  assert.equal(document.title, "Page title");
  assert.equal(document.url, "https://example.com/final");
  assert.equal(document.provenance.kind, "web");
  assert.ok(document.provenance.retrievedAt);
  await assert.rejects(store.import({ content: "x".repeat(1024 * 1024 + 1) }), /1 MiB/);
  await assert.rejects(store.import({ content: "valid", url: "file:///etc/passwd" }), /HTTP/);
  await assert.rejects(store.import({ content: "valid", profileID: "*" }), /profileID/);
  const blocked = await fixture(t, { webTools: { fetchContent: async () => ({ pages: [{ error: "private network refused" }] }) } });
  await assert.rejects(blocked.import({ url: "https://example.com" }), /private network refused/);
});
