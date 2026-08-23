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
      { role: "user", content: "Remember the cobalt hummingbird project." },
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
  store.database.close();
});
