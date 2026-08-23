import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { browserHistoryPath, memoryDatabasePath } from "../paths.js";

const fullContentLimit = 20_000;
const summaryLimit = 900;
const storedPageContentLimit = 100_000;
const semanticCandidateLimit = 400;
const semanticTextLimit = 4_000;
const semanticModel = "apple-natural-language-en-v1";
const memoryEntryTypes = new Set(["navigation", "conversation", "connector"]);
const searchStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "for",
  "from", "had", "has", "have", "i", "in", "is", "it", "me", "my", "of",
  "on", "or", "that", "the", "this", "to", "was", "were", "what", "with",
  "you", "your",
]);

const memoryToolDefinitions = [
  {
    name: "mcp__dia-tools__memory_search",
    description: "Search the user's local Dia Custom browsing, chat, and imported connector memory with lexical and on-device semantic matching. This runs entirely on this Mac.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or phrases to search for" },
        limit: { type: "integer", description: "Maximum results, from 1 to 50" },
        entryTypes: {
          type: "array",
          items: { type: "string", enum: [...memoryEntryTypes] },
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    source: "local",
  },
  {
    name: "mcp__dia-tools__memory_query",
    description: "Query and retrieve local Dia Custom memory entries from browsing and chat history. Use URIs returned by memory_search to retrieve full content. This runs entirely on this Mac.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        uris: { type: "array", items: { type: "string" } },
        urlPrefix: { type: "string" },
        entryTypes: {
          type: "array",
          items: { type: "string", enum: [...memoryEntryTypes] },
        },
        mode: { type: "string", enum: ["summary", "fullContent"] },
        startTime: { type: "string", description: "ISO-8601 lower time bound" },
        endTime: { type: "string", description: "ISO-8601 upper time bound" },
        limit: { type: "integer", description: "Maximum results, from 1 to 50" },
      },
      additionalProperties: false,
    },
    source: "local",
  },
];

function boundedLimit(value, fallback = 10) {
  return Math.max(1, Math.min(50, Number.isInteger(value) ? value : fallback));
}

function ftsTerms(value) {
  if (typeof value !== "string") return [];
  const terms = value.normalize("NFKC").match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const meaningful = terms.filter((term) => !searchStopWords.has(term.toLowerCase()));
  return (meaningful.length > 0 ? meaningful : terms)
    .slice(0, 20)
    .map((term) => `"${term.replaceAll('"', '""')}"`);
}

function ftsQuery(value, joiner = " AND ") {
  return ftsTerms(value).join(joiner);
}

function excerpt(value, length) {
  if (typeof value !== "string") return "";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function textBlocks(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n");
}

function conversationText(message) {
  const text = textBlocks(message?.content).trim();
  if (!text) return "";
  if (message?.role !== "user") return excerpt(text, storedPageContentLimit);
  const userMessages = [...text.matchAll(/<user-message>\s*([\s\S]*?)\s*<\/user-message>/gi)];
  if (userMessages.length > 0) {
    return excerpt(userMessages.at(-1)[1].trim(), storedPageContentLimit);
  }
  // A harness-only continuation can contain reminders without a new user
  // message. Do not turn Dia's hidden prompt/tool inventory into user memory.
  if (/<(?:system-reminder|agent-context|user-context|user_app_signal)>/i.test(text)) {
    return "";
  }
  return excerpt(text, storedPageContentLimit);
}

function stableChatURI(role, content) {
  const digest = createHash("sha256").update(`${role}\0${content}`).digest("hex");
  return `dia-custom-chat:${digest}`;
}

function parsePossibleJSON(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function browserPagesFromValue(value, pages, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    const parsed = parsePossibleJSON(value);
    if (parsed) browserPagesFromValue(parsed, pages, depth + 1);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) browserPagesFromValue(item, pages, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const rawURL = [value.url, value.href, value.source_url, value.sourceURL]
    .find((candidate) => typeof candidate === "string");
  if (rawURL) {
    try {
      const url = new URL(rawURL);
      if (["http:", "https:"].includes(url.protocol)) {
        const title = [value.title, value.name, value.page_title]
          .find((candidate) => typeof candidate === "string") ?? url.toString();
        const content = [value.content, value.text, value.markdown, value.body, value.excerpt]
          .find((candidate) => typeof candidate === "string") ?? "";
        pages.set(url.toString(), {
          url: url.toString(),
          title,
          content: excerpt(content, storedPageContentLimit),
        });
      }
    } catch {
      // Ignore non-URL identifiers returned by native tools.
    }
  }
  for (const child of Object.values(value)) browserPagesFromValue(child, pages, depth + 1);
}

function browserPagesFromMessages(messages) {
  const pages = new Map();
  for (const message of messages ?? []) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type !== "tool_result") continue;
      browserPagesFromValue(block.content, pages);
      if (Array.isArray(block.content)) {
        for (const item of block.content) browserPagesFromValue(item?.text ?? item, pages);
      }
    }
  }
  return [...pages.values()];
}

function encodeVector(values) {
  const vector = Float32Array.from(values);
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function decodeVector(value) {
  if (!value) return null;
  const bytes = Buffer.from(value);
  if (bytes.byteLength % 4 !== 0) return null;
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length || left.length === 0) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export class MemoryStore {
  constructor(
    path = memoryDatabasePath,
    historyPath = browserHistoryPath,
    { embedder = null } = {},
  ) {
    this.path = path;
    this.historyPath = historyPath;
    this.embedder = embedder;
    this.embeddingDisabledReason = null;
    this.database = null;
  }

  async open() {
    if (this.database) return this;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.path);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY,
        uri TEXT NOT NULL UNIQUE,
        entry_type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entries_type_time
        ON entries(entry_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS entries_url
        ON entries(url);
      CREATE TABLE IF NOT EXISTS entry_embeddings (
        entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        vector BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        title, url, content,
        content='entries', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, title, url, content)
        VALUES (new.id, new.title, new.url, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, url, content)
        VALUES ('delete', old.id, old.title, old.url, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, url, content)
        VALUES ('delete', old.id, old.title, old.url, old.content);
        INSERT INTO entries_fts(rowid, title, url, content)
        VALUES (new.id, new.title, new.url, new.content);
      END;
    `);
    await chmod(dirname(this.path), 0o700);
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      await chmod(path, 0o600).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
    return this;
  }

  upsert(entry) {
    const existing = this.database.prepare(
      "SELECT id, title, url, content FROM entries WHERE uri = ?",
    ).get(entry.uri);
    this.database.prepare(`
      INSERT INTO entries
        (uri, entry_type, title, url, content, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uri) DO UPDATE SET
        title=excluded.title,
        url=excluded.url,
        content=excluded.content,
        source=excluded.source,
        updated_at=MAX(entries.updated_at, excluded.updated_at)
    `).run(
      entry.uri,
      entry.entryType,
      entry.title ?? "",
      entry.url ?? "",
      entry.content ?? "",
      entry.source,
      entry.createdAt,
      entry.updatedAt,
    );
    if (existing && (
      existing.title !== (entry.title ?? "") ||
      existing.url !== (entry.url ?? "") ||
      existing.content !== (entry.content ?? "")
    )) {
      this.database.prepare("DELETE FROM entry_embeddings WHERE entry_id = ?")
        .run(existing.id);
    }
  }

  async importBrowserHistory(limit = 25_000) {
    await this.open();
    if (!this.historyPath || !existsSync(this.historyPath)) return 0;
    let history;
    try {
      history = new DatabaseSync(this.historyPath, { readOnly: true });
      const rows = history.prepare(`
        SELECT
          url,
          COALESCE(title, '') AS title,
          visit_count,
          CAST((last_visit_time / 1000000 - 11644473600) * 1000 AS INTEGER) AS time_ms
        FROM urls
        WHERE url NOT LIKE 'dia://%' AND url NOT LIKE 'chrome://%'
        ORDER BY last_visit_time DESC
        LIMIT ?
      `).all(limit);
      this.database.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          const time = Number(row.time_ms) || Date.now();
          this.upsert({
            uri: `navigation:${row.url}`,
            entryType: "navigation",
            title: row.title || row.url,
            url: row.url,
            content: `${row.title || ""}\n${row.url}\nVisited ${row.visit_count} time(s).`,
            source: "chromium-history",
            createdAt: time,
            updatedAt: time,
          });
        }
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
      return rows.length;
    } catch (error) {
      process.stderr.write(`Local history import skipped: ${String(error?.message ?? error)}\n`);
      return 0;
    } finally {
      history?.close();
    }
  }

  async recordConversation(payload, result) {
    await this.open();
    const now = Date.now();
    const entries = [];
    for (const message of payload?.messages ?? []) {
      if (!["user", "assistant"].includes(message?.role)) continue;
      const content = conversationText(message);
      if (!content) continue;
      entries.push({ role: message.role, content });
    }
    if (result?.kind === "final" && typeof result.text === "string" && result.text.trim()) {
      entries.push({ role: "assistant", content: result.text.trim() });
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const page of browserPagesFromMessages(payload?.messages)) {
        this.upsert({
          uri: `navigation:${page.url}`,
          entryType: "navigation",
          title: page.title,
          url: page.url,
          content: `${page.title}\n${page.url}${page.content ? `\n\n${page.content}` : ""}`,
          source: "native-tool-result",
          createdAt: now,
          updatedAt: now,
        });
      }
      for (const entry of entries) {
        this.upsert({
          uri: stableChatURI(entry.role, entry.content),
          entryType: "conversation",
          title: `${entry.role === "user" ? "You" : "Assistant"}: ${excerpt(entry.content.replaceAll("\n", " "), 100)}`,
          url: "",
          content: entry.content,
          source: "dia-custom-chat",
          createdAt: now,
          updatedAt: now,
        });
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async importConnector({ id, label, records, replace = true } = {}) {
    await this.open();
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      throw new Error("connector id must use 1-64 lowercase letters, numbers, underscores, or hyphens");
    }
    if (!Array.isArray(records) || records.length === 0 || records.length > 5_000) {
      throw new Error("connector import requires 1-5,000 records");
    }
    const connectorLabel = typeof label === "string" && label.trim()
      ? label.trim().slice(0, 120)
      : id;
    const now = Date.now();
    let imported = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (replace) {
        this.database.prepare("DELETE FROM entries WHERE source IN (?, ?)")
          .run(`connector:${id}:document`, `connector:${id}:person`);
      }
      for (const record of records) {
        if (!record || typeof record !== "object" || Array.isArray(record)) continue;
        const title = [record.title, record.name, record.subject]
          .find((value) => typeof value === "string" && value.trim())?.trim().slice(0, 500) ?? "Untitled";
        const rawContent = [record.content, record.text, record.description, record.body]
          .find((value) => typeof value === "string" && value.trim()) ?? "";
        const metadata = record.metadata && typeof record.metadata === "object"
          ? `\n\nMetadata: ${JSON.stringify(record.metadata).slice(0, 20_000)}`
          : "";
        const content = excerpt(`${title}\n${rawContent}${metadata}`, storedPageContentLimit);
        let url = "";
        if (typeof record.url === "string") {
          try {
            const parsed = new URL(record.url);
            if (["http:", "https:"].includes(parsed.protocol)) url = parsed.toString();
          } catch {
            // A connector record does not need a URL.
          }
        }
        const kind = record.kind === "person" ? "person" : "document";
        const stableID = typeof record.id === "string" && record.id
          ? record.id
          : createHash("sha256").update(`${title}\0${url}\0${content}`).digest("hex");
        const digest = createHash("sha256").update(stableID).digest("hex");
        const updatedAt = Number.isFinite(Date.parse(record.updatedAt ?? ""))
          ? Date.parse(record.updatedAt)
          : now;
        this.upsert({
          uri: `dia-custom-connector:${id}:${digest}`,
          entryType: "connector",
          title,
          url,
          content,
          source: `connector:${id}:${kind}`,
          createdAt: updatedAt,
          updatedAt,
        });
        imported += 1;
      }
      this.database.prepare(`
        INSERT INTO connectors(id, label, imported_at, item_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label,
          imported_at=excluded.imported_at,
          item_count=excluded.item_count
      `).run(id, connectorLabel, now, imported);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { id, label: connectorLabel, imported, replace };
  }

  async connectors() {
    await this.open();
    return this.database.prepare(`
      SELECT c.id, c.label, c.imported_at, COUNT(e.id) AS item_count
      FROM connectors c
      LEFT JOIN entries e ON e.source IN (
        'connector:' || c.id || ':document',
        'connector:' || c.id || ':person'
      )
      GROUP BY c.id, c.label, c.imported_at
      ORDER BY c.label COLLATE NOCASE
    `).all().map((row) => ({
      id: row.id,
      label: row.label,
      importedAt: new Date(row.imported_at).toISOString(),
      itemCount: Number(row.item_count),
    }));
  }

  async deleteConnector(id) {
    await this.open();
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      throw new Error("invalid connector id");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const deleted = Number(this.database.prepare("DELETE FROM entries WHERE source IN (?, ?)")
        .run(`connector:${id}:document`, `connector:${id}:person`).changes);
      this.database.prepare("DELETE FROM connectors WHERE id = ?").run(id);
      this.database.exec("COMMIT");
      return { id, deleted };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async recentPeople(limit = 20) {
    await this.open();
    const bounded = boundedLimit(limit, 20);
    const rows = this.database.prepare(`
      SELECT * FROM entries
      WHERE entry_type = 'connector' AND source LIKE 'connector:%:person'
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(bounded);
    return { people: this.formatRows(rows, "summary") };
  }

  async lookupPerson(query, limit = 10) {
    const result = await this.search({
      query,
      entryTypes: ["connector"],
      sourceSuffix: ":person",
      limit,
    });
    return { query, people: result.results };
  }

  filters(input, values) {
    const clauses = [];
    if (Array.isArray(input.entryTypes) && input.entryTypes.length > 0) {
      const types = input.entryTypes.filter((type) => memoryEntryTypes.has(type));
      if (types.length > 0) {
        clauses.push(`e.entry_type IN (${types.map(() => "?").join(",")})`);
        values.push(...types);
      }
    }
    if (typeof input.urlPrefix === "string" && input.urlPrefix) {
      clauses.push("e.url LIKE ?");
      values.push(`${input.urlPrefix}%`);
    }
    if (Array.isArray(input.connectorIDs) && input.connectorIDs.length > 0) {
      const ids = input.connectorIDs.filter((id) =>
        typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id));
      if (ids.length > 0) {
        clauses.push(`(${ids.map(() => "e.source IN (?, ?)").join(" OR ")})`);
        values.push(...ids.flatMap((id) => [
          `connector:${id}:document`,
          `connector:${id}:person`,
        ]));
      }
    }
    if (typeof input.sourceSuffix === "string" && input.sourceSuffix) {
      clauses.push("e.source LIKE ?");
      values.push(`%${input.sourceSuffix}`);
    }
    const start = Date.parse(input.startTime ?? "");
    if (Number.isFinite(start)) {
      clauses.push("e.updated_at >= ?");
      values.push(start);
    }
    const end = Date.parse(input.endTime ?? "");
    if (Number.isFinite(end)) {
      clauses.push("e.updated_at <= ?");
      values.push(end);
    }
    return clauses;
  }

  formatRows(rows, mode = "summary") {
    const length = mode === "fullContent" ? fullContentLimit : summaryLimit;
    return rows.map((row) => ({
      uri: row.uri,
      entryType: row.entry_type,
      title: row.title,
      ...(row.url ? { url: row.url } : {}),
      content: excerpt(row.content, length),
      timestamp: new Date(row.updated_at).toISOString(),
      source: row.source,
    }));
  }

  async embeddingVectors(texts) {
    if (!this.embedder || this.embeddingDisabledReason) return null;
    try {
      const value = await this.embedder(texts);
      const vectors = Array.isArray(value) ? value : value?.vectors;
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error("embedding helper returned an unexpected vector count");
      }
      return vectors;
    } catch (error) {
      this.embeddingDisabledReason = String(error?.message ?? error);
      process.stderr.write(`Local semantic memory disabled: ${this.embeddingDisabledReason}\n`);
      return null;
    }
  }

  async semanticRows(input) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query || !this.embedder || this.embeddingDisabledReason) return [];
    const values = [];
    const clauses = this.filters(input, values);
    values.push(semanticCandidateLimit);
    const candidates = this.database.prepare(`
      SELECT e.*, x.model AS embedding_model, x.vector AS embedding_vector
      FROM entries e
      LEFT JOIN entry_embeddings x ON x.entry_id = e.id
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY e.updated_at DESC
      LIMIT ?
    `).all(...values);
    if (candidates.length === 0) return [];

    const queryVectors = await this.embeddingVectors([query]);
    if (!queryVectors?.[0]) return [];
    const missing = candidates.filter((row) =>
      row.embedding_model !== semanticModel || !row.embedding_vector);
    for (let offset = 0; offset < missing.length; offset += 128) {
      const batch = missing.slice(offset, offset + 128);
      const texts = batch.map((row) =>
        excerpt(`${row.title}\n${row.url}\n${row.content}`, semanticTextLimit));
      const vectors = await this.embeddingVectors(texts);
      if (!vectors) break;
      const statement = this.database.prepare(`
        INSERT INTO entry_embeddings(entry_id, model, vector, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET
          model=excluded.model,
          vector=excluded.vector,
          updated_at=excluded.updated_at
      `);
      for (let index = 0; index < batch.length; index += 1) {
        const vector = vectors[index];
        if (!Array.isArray(vector) || vector.length === 0) continue;
        const encoded = encodeVector(vector);
        batch[index].embedding_model = semanticModel;
        batch[index].embedding_vector = encoded;
        statement.run(batch[index].id, semanticModel, encoded, Date.now());
      }
    }

    const queryVector = Float32Array.from(queryVectors[0]);
    return candidates
      .map((row) => ({
        ...row,
        semantic_score: cosineSimilarity(queryVector, decodeVector(row.embedding_vector)),
      }))
      .filter((row) => row.semantic_score >= 0.30)
      .sort((left, right) => right.semantic_score - left.semantic_score ||
        right.updated_at - left.updated_at)
      .slice(0, boundedLimit(input.limit));
  }

  async search(input) {
    await this.open();
    const terms = ftsTerms(input.query);
    const match = terms.join(" AND ");
    const run = (expression) => {
      const values = [expression];
      const clauses = ["entries_fts MATCH ?", ...this.filters(input, values)];
      values.push(boundedLimit(input.limit));
      return this.database.prepare(`
        SELECT e.*, bm25(entries_fts, 4.0, 1.5, 1.0) AS rank
        FROM entries_fts
        JOIN entries e ON e.id = entries_fts.rowid
        WHERE ${clauses.join(" AND ")}
        ORDER BY rank, e.updated_at DESC
        LIMIT ?
      `).all(...values);
    };
    let rows = match ? run(match) : [];
    let matchMode = rows.length > 0 ? "all-terms" : "none";
    if (rows.length === 0 && terms.length > 1) {
      rows = run(terms.join(" OR "));
      if (rows.length > 0) matchMode = "best-effort";
    }
    const semantic = await this.semanticRows(input);
    if (semantic.length > 0) {
      const seen = new Set(rows.map((row) => row.id));
      const additions = semantic.filter((row) => !seen.has(row.id));
      rows = [...rows, ...additions].slice(0, boundedLimit(input.limit));
      matchMode = matchMode === "none" ? "semantic" : `${matchMode}+semantic`;
    }
    return {
      query: input.query,
      matchMode,
      results: this.formatRows(rows, "summary"),
    };
  }

  async query(input) {
    await this.open();
    const limit = boundedLimit(input.limit);
    let rows;
    if (Array.isArray(input.uris) && input.uris.length > 0) {
      const uris = input.uris.slice(0, 50).filter((uri) => typeof uri === "string");
      if (uris.length === 0) return { results: [] };
      const values = [...uris];
      const clauses = [
        `e.uri IN (${uris.map(() => "?").join(",")})`,
        ...this.filters(input, values),
      ];
      values.push(limit);
      rows = this.database.prepare(`
        SELECT e.* FROM entries e
        WHERE ${clauses.join(" AND ")}
        ORDER BY e.updated_at DESC
        LIMIT ?
      `).all(...values);
    } else if (ftsQuery(input.query)) {
      const result = await this.search({ ...input, limit });
      if (input.mode !== "fullContent") return result;
      const uris = result.results.map((entry) => entry.uri);
      rows = uris.length === 0 ? [] : this.database.prepare(`
        SELECT * FROM entries
        WHERE uri IN (${uris.map(() => "?").join(",")})
        ORDER BY updated_at DESC
      `).all(...uris);
    } else {
      const values = [];
      const clauses = this.filters(input, values);
      values.push(limit);
      rows = this.database.prepare(`
        SELECT e.* FROM entries e
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY e.updated_at DESC
        LIMIT ?
      `).all(...values);
    }
    return { results: this.formatRows(rows, input.mode ?? "summary") };
  }

  async stats() {
    await this.open();
    const rows = this.database.prepare(`
      SELECT entry_type, COUNT(*) AS count, MIN(updated_at) AS oldest, MAX(updated_at) AS newest
      FROM entries
      GROUP BY entry_type
      ORDER BY entry_type
    `).all();
    const embedded = this.database.prepare(
      "SELECT COUNT(*) AS count FROM entry_embeddings WHERE model = ?",
    ).get(semanticModel)?.count ?? 0;
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count), 0),
      embedded: Number(embedded),
      semanticAvailable: Boolean(this.embedder) && !this.embeddingDisabledReason,
      ...(this.embeddingDisabledReason ? { semanticError: this.embeddingDisabledReason } : {}),
      entryTypes: Object.fromEntries(rows.map((row) => [row.entry_type, {
        count: Number(row.count),
        oldest: row.oldest ? new Date(row.oldest).toISOString() : null,
        newest: row.newest ? new Date(row.newest).toISOString() : null,
      }])),
    };
  }

  async exportEntries(limit = 100_000) {
    await this.open();
    const bounded = Math.max(1, Math.min(100_000, Number.isInteger(limit) ? limit : 100_000));
    const rows = this.database.prepare(`
      SELECT uri, entry_type, title, url, content, source, created_at, updated_at
      FROM entries
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(bounded);
    return {
      format: "dia-custom-memory-v1",
      exportedAt: new Date().toISOString(),
      entries: rows.map((row) => ({
        uri: row.uri,
        entryType: row.entry_type,
        title: row.title,
        url: row.url,
        content: row.content,
        source: row.source,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    };
  }

  async deleteEntries({ entryTypes = [], before = null, all = false } = {}) {
    await this.open();
    const clauses = [];
    const values = [];
    const types = entryTypes.filter((type) => memoryEntryTypes.has(type));
    if (types.length > 0) {
      clauses.push(`entry_type IN (${types.map(() => "?").join(",")})`);
      values.push(...types);
    }
    const beforeTime = typeof before === "string" ? Date.parse(before) : Number.NaN;
    if (Number.isFinite(beforeTime)) {
      clauses.push("updated_at < ?");
      values.push(beforeTime);
    }
    if (clauses.length === 0 && !all) {
      throw new Error("memory deletion requires entryTypes, before, or all=true");
    }
    const result = this.database.prepare(
      `DELETE FROM entries${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`,
    ).run(...values);
    return { deleted: Number(result.changes) };
  }

  async prune({ retentionDays = 0, maxEntries = 100_000 } = {}) {
    await this.open();
    let deleted = 0;
    const days = Number.isFinite(retentionDays) ? Math.max(0, retentionDays) : 0;
    if (days > 0) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      deleted += Number(this.database.prepare("DELETE FROM entries WHERE updated_at < ?")
        .run(cutoff).changes);
    }
    const maximum = Number.isInteger(maxEntries)
      ? Math.max(1_000, Math.min(1_000_000, maxEntries))
      : 100_000;
    deleted += Number(this.database.prepare(`
      DELETE FROM entries WHERE id IN (
        SELECT id FROM entries ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `).run(maximum).changes);
    return { deleted, ...(await this.stats()) };
  }
}

export function localMemoryTools() {
  return memoryToolDefinitions.map((tool) => ({ ...tool }));
}

export function isLocalMemoryTool(name) {
  return [
    "memory_search",
    "memory_query",
    "mcp__dia-tools__memory_search",
    "mcp__dia-tools__memory_query",
  ].includes(name);
}

export async function executeLocalMemoryTool(store, name, input) {
  if (name.endsWith("memory_search")) return store.search(input ?? {});
  if (name.endsWith("memory_query")) return store.query(input ?? {});
  throw new Error(`unknown local memory tool: ${name}`);
}
