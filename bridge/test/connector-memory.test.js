import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore, executeLocalMemoryTool } from "../src/local-tools/memory.js";
import { executeLocalConnectorTool } from "../src/local-tools/connectors.js";

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-connector-memory-"));
  const path = resolve(directory, "memory.sqlite");
  const store = new MemoryStore(path, null);
  t.after(async () => { store.database?.close(); await rm(directory, { force: true, recursive: true }); });
  return { store, path };
}

test("incremental connector imports, updates, deletions and person queries remain profile-scoped", async (t) => {
  const { store } = await fixture(t);
  const person = (content) => [{ id: "shared-id", kind: "person", title: "Ada", content }];
  await store.importConnector({ id: "Service.one", profileID: "Work", records: person("PrivateWorkEmail") });
  await store.importConnector({ id: "Service.one", profileID: "Default", records: person("PersonalEmail") });
  const work = await store.search({ query: "PrivateWorkEmail", profileID: "Work" });
  assert.equal(work.results.length, 1);
  assert.equal((await store.search({ query: "PrivateWorkEmail", profileID: "Default" })).results.length, 0);
  assert.equal((await executeLocalConnectorTool(store, "connector_query", { uris: [work.results[0].uri], profileID: "Work" }, { profileID: "Default" })).results.length, 0);
  assert.equal((await executeLocalConnectorTool(store, "list_recent_people", {}, { profileID: "Default" })).people[0].content.includes("PersonalEmail"), true);
  assert.equal((await executeLocalConnectorTool(store, "lookup_person", { query: "Ada" }, { profileID: "Work" })).people[0].content.includes("PrivateWorkEmail"), true);
  assert.equal((await executeLocalMemoryTool(store, "memory_search", { query: "PrivateWorkEmail", allProfiles: true, profileID: "Work" }, { profileID: "Default" })).results.length, 0);
  await store.importConnector({ id: "Service.one", profileID: "Work", records: person("UpdatedWorkEmail"), replace: false });
  assert.equal((await store.connectors({ profileID: "Work" }))[0].itemCount, 1);
  await store.importConnector({ id: "Service.one", profileID: "Work", records: [], deletedIDs: ["shared-id"], replace: false });
  assert.equal((await store.connectors({ profileID: "Work" }))[0].itemCount, 0);
  assert.equal((await store.connectors({ profileID: "Default" }))[0].itemCount, 1);
  await store.deleteConnector("Service.one", { profileID: "Work" });
  assert.equal((await store.connectors({ profileID: "Default" })).length, 1);
});

test("legacy globally shared imports migrate into Default and survive later scoped imports and reopening", async (t) => {
  const { store, path } = await fixture(t);
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE connectors(id TEXT PRIMARY KEY, label TEXT NOT NULL, imported_at INTEGER NOT NULL, item_count INTEGER NOT NULL DEFAULT 0);
    INSERT INTO connectors VALUES('legacy','Legacy import',100,1);
    CREATE TABLE entries(id INTEGER PRIMARY KEY, uri TEXT NOT NULL UNIQUE, entry_type TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, profile_id TEXT NOT NULL DEFAULT 'Default', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO entries(uri,entry_type,title,content,source,profile_id,created_at,updated_at) VALUES('dia-custom-connector:legacy:digest','connector','Legacy','LegacyPersonalData','connector:legacy:document','*',100,100);`);
  db.exec("CREATE VIRTUAL TABLE entries_fts USING fts5(title,url,content,content='entries',content_rowid='id'); INSERT INTO entries_fts(entries_fts) VALUES('rebuild');");
  db.close();
  await store.open();
  assert.equal((await store.search({ query: "LegacyPersonalData", profileID: "Default" })).results.length, 1);
  assert.equal((await store.search({ query: "LegacyPersonalData", profileID: "Work" })).results.length, 0);
  await store.importConnector({ id: "legacy", profileID: "Work", records: [{ id: "work", content: "ScopedWorkData" }] });
  const reopened = new MemoryStore(path, null);
  await reopened.open();
  try {
    assert.equal((await reopened.search({ query: "ScopedWorkData", profileID: "Work" })).results.length, 1);
    assert.equal((await reopened.search({ query: "ScopedWorkData", profileID: "Default" })).results.length, 0);
  } finally { reopened.database.close(); }
});
