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
  assert.equal(exported.format, "dia-custom-memory-v1");
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
