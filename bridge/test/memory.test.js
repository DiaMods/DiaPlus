import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MemoryStore } from "../src/local-tools/memory.js";

test("local memory imports browser history and captures conversations", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-memory-"));
  const historyPath = resolve(directory, "History");
  const history = new DatabaseSync(historyPath);
  history.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY,
      url TEXT,
      title TEXT,
      visit_count INTEGER,
      last_visit_time INTEGER
    );
  `);
  const chromiumNow = (BigInt(Date.now()) + 11644473600000n) * 1000n;
  history.prepare("INSERT INTO urls(url,title,visit_count,last_visit_time) VALUES(?,?,?,?)")
    .run("https://example.com/local-memory", "Local Memory Example", 3, chromiumNow);
  history.close();

  const store = new MemoryStore(resolve(directory, "memory.sqlite3"), historyPath);
  assert.equal(await store.importBrowserHistory(), 1);
  const navigation = await store.search({ query: "Local Memory Example" });
  assert.equal(navigation.results.length, 1);
  assert.equal(navigation.results[0].entryType, "navigation");

  await store.recordConversation({
    messages: [
      {
        role: "user",
        content: "<system-reminder>hidden harness inventory</system-reminder>\n<user-message>Remember the cobalt hummingbird project.</user-message>",
      },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "read_1",
          content: JSON.stringify({
            url: "https://example.com/project",
            title: "Cobalt Project Notes",
            content: "The launch checklist uses a hummingbird mascot.",
          }),
        }],
      },
    ],
  }, {
    kind: "final",
    text: "I will remember the cobalt hummingbird project locally.",
  });
  const conversation = await store.search({ query: "cobalt hummingbird" });
  assert.ok(conversation.results.length >= 2);
  assert.equal((await store.search({ query: "hidden harness inventory" })).results.length, 0);
  const full = await store.query({
    uris: [conversation.results[0].uri],
    mode: "fullContent",
  });
  assert.match(full.results[0].content, /cobalt hummingbird/i);
  const page = await store.search({ query: "launch checklist hummingbird" });
  assert.equal(page.results[0].url, "https://example.com/project");
  assert.equal(page.results[0].source, "native-tool-result");
  const partial = await store.search({ query: "unmatched verification cobalt" });
  assert.equal(partial.matchMode, "best-effort");
  assert.match(partial.results[0].content, /cobalt/i);
  const stats = await store.stats();
  assert.ok(stats.total >= 4);
  assert.equal(stats.semanticAvailable, false);
  const exported = await store.exportEntries();
  assert.equal(exported.format, "dia-custom-memory-v2");
  assert.equal(exported.entries.length, stats.total);

  const imported = await store.importConnector({
    id: "contacts",
    label: "Contacts",
    records: [{
      id: "ada",
      name: "Ada Lovelace",
      kind: "person",
      content: "ada@example.test · Analytical Engine project",
      updatedAt: "2026-08-20T12:00:00Z",
    }, {
      id: "project-plan",
      title: "Service project plan",
      content: "Launch the local connector prototype in September.",
    }],
  });
  assert.equal(imported.imported, 2);
  assert.equal((await store.connectors())[0].itemCount, 2);
  const connectorSearch = await store.search({
    query: "connector prototype September",
    entryTypes: ["connector"],
  });
  assert.equal(connectorSearch.results[0].source, "connector:contacts:document");
  const connectorBoundary = await store.query({
    uris: [navigation.results[0].uri],
    entryTypes: ["connector"],
  });
  assert.equal(connectorBoundary.results.length, 0);
  const person = await store.lookupPerson("Ada Lovelace");
  assert.match(person.people[0].content, /Analytical Engine/);
  assert.equal((await store.deleteConnector("contacts")).deleted, 2);
  const deleted = await store.deleteEntries({ entryTypes: ["conversation"] });
  assert.ok(deleted.deleted >= 2);
  store.database.close();
});

test("local memory derives durable profile-scoped Memories and filters private or sensitive activity", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-derived-memory-"));
  const store = new MemoryStore(resolve(directory, "memory.sqlite3"), null);

  const captured = await store.recordConversation({
    metadata: { profileID: "Profile 2" },
    messages: [{
      role: "user",
      content: "I am comparing Oslo restaurants for a September anniversary trip.",
    }],
  }, {
    kind: "final",
    text: "I can compare the neighborhoods and make a shortlist.",
  });
  assert.ok(captured.recorded >= 2);

  const derived = await store.derivePending((batch) => ({
    memories: [{
      text: "The user is planning a September anniversary trip to Oslo and is interested in local restaurants.",
      title: "Oslo anniversary trip",
      kind: "plan",
      confidence: 0.93,
      sourceUris: [batch.entries[0].uri],
    }],
  }), { profileID: "Profile 2" });
  assert.equal(derived.created, 1);
  assert.equal(
    store.database.prepare("SELECT COUNT(*) AS count FROM memory_sources").get().count,
    1,
  );

  const recalled = await store.automaticContext("Oslo anniversary restaurants", {
    profileID: "Profile 2",
  });
  assert.equal(recalled.memories[0].entryType, "memory");
  assert.equal(recalled.memories[0].memoryKind, "plan");
  assert.equal((await store.search({
    query: "Oslo anniversary restaurants",
    profileID: "Default",
  })).results.length, 0);

  const privateCapture = await store.recordConversation({
    metadata: { profileID: "Profile 2", incognito: true },
    messages: [{ role: "user", content: "private-only-redwood-marker" }],
  }, { kind: "final", text: "Private response." });
  assert.equal(privateCapture.private, true);
  assert.equal(privateCapture.recorded, 0);

  const sensitiveCapture = await store.recordConversation({
    metadata: { profileID: "Profile 2" },
    messages: [{
      role: "user",
      content: "My diagnosis and medication dosage are sensitive-clinical-marker.",
    }],
  }, { kind: "final", text: "Understood." });
  assert.equal(sensitiveCapture.sensitive, true);
  assert.equal(sensitiveCapture.recorded, 0);

  await store.recordConversation({
    metadata: { profileID: "Profile 2" },
    messages: [
      { role: "user", content: "Review the attached page." },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "read_excluded",
          content: JSON.stringify({
            url: "https://private.example/excluded-path",
            title: "Excluded page marker",
            content: "excluded-page-content-marker",
          }),
        }],
      },
    ],
  }, { kind: "final", text: "Reviewed." }, { excludedHosts: ["private.example"] });
  assert.equal((await store.search({
    query: "excluded-page-content-marker",
    profileID: "Profile 2",
    entryTypes: ["navigation"],
  })).results.length, 0);

  store.database.close();
});

test("local memory adds lazy on-device semantic retrieval", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-semantic-memory-"));
  const embedder = async (texts) => ({
    vectors: texts.map((text) => /ornithological|hummingbird/i.test(text)
      ? [1, 0, 0]
      : [0, 1, 0]),
  });
  const store = new MemoryStore(
    resolve(directory, "memory.sqlite3"),
    null,
    { embedder },
  );
  await store.recordConversation({
    messages: [{ role: "user", content: "The cobalt hummingbird project launches Friday." }],
  }, { kind: "final", text: "Saved." });

  const result = await store.search({ query: "ornithological initiative", limit: 5 });
  assert.equal(result.matchMode, "semantic");
  assert.match(result.results[0].content, /hummingbird/i);
  const stats = await store.stats();
  assert.equal(stats.semanticAvailable, true);
  assert.ok(stats.embedded >= 1);
  store.database.close();
});

test("local memory migration deduplicates legacy unscoped navigation URIs", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-memory-migration-"));
  const path = resolve(directory, "memory.sqlite3");
  const first = new MemoryStore(path, null);
  await first.open();
  const now = Date.now();
  for (const uri of [
    "navigation:https://example.test/profile-migration",
    "navigation:Default:https://example.test/profile-migration",
  ]) {
    first.upsert({
      uri,
      entryType: "navigation",
      title: "Profile migration",
      url: "https://example.test/profile-migration",
      content: "Profile migration marker",
      source: "chromium-history",
      profileID: "Default",
      createdAt: now,
      updatedAt: now,
    });
  }
  first.database.close();

  const migrated = new MemoryStore(path, null);
  await migrated.open();
  const rows = migrated.database.prepare(
    "SELECT uri FROM entries WHERE entry_type = 'navigation' AND url = ?",
  ).all("https://example.test/profile-migration");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uri, "navigation:Default:https://example.test/profile-migration");
  migrated.database.exec(`
    CREATE TABLE migration_update_audit (entry_id INTEGER);
    CREATE TRIGGER migration_update_audit_trigger AFTER UPDATE ON entries BEGIN
      INSERT INTO migration_update_audit(entry_id) VALUES (new.id);
    END;
  `);
  migrated.database.close();

  const reopened = new MemoryStore(path, null);
  await reopened.open();
  assert.equal(
    reopened.database.prepare("SELECT COUNT(*) AS count FROM migration_update_audit").get().count,
    0,
  );
  reopened.database.close();
});

test("local memory does not rewrite full-text rows for identical upserts", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-memory-fts-update-"));
  const store = new MemoryStore(resolve(directory, "memory.sqlite3"), null);
  await store.open();
  const entry = {
    uri: "navigation:Default:https://example.test/stable",
    entryType: "navigation",
    title: "Stable entry",
    url: "https://example.test/stable",
    content: "Unchanged local memory content",
    source: "chromium-history",
    profileID: "Default",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.upsert(entry);
  const before = store.database.prepare("SELECT total_changes() AS count").get().count;
  store.upsert(entry);
  const after = store.database.prepare("SELECT total_changes() AS count").get().count;
  assert.equal(after - before, 1);
  store.database.close();
});
