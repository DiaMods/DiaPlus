import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { browserHistoryPath, memoryDatabasePath } from "../paths.js";

const fullContentLimit = 20_000;
const summaryLimit = 900;
const storedPageContentLimit = 100_000;
const searchStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "did", "do", "for",
  "from", "had", "has", "have", "i", "in", "is", "it", "me", "my", "of",
  "on", "or", "that", "the", "this", "to", "was", "were", "what", "with",
  "you", "your",
]);

const memoryToolDefinitions = [
  {
    name: "mcp__dia-tools__memory_search",
    description: "Search the user's local Dia Custom browsing and chat history by exact words or phrases. This runs entirely on this Mac.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or phrases to search for" },
        limit: { type: "integer", description: "Maximum results, from 1 to 50" },
        entryTypes: {
          type: "array",
          items: { type: "string", enum: ["navigation", "conversation"] },
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
          items: { type: "string", enum: ["navigation", "conversation"] },
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

export class MemoryStore {
  constructor(path = memoryDatabasePath, historyPath = browserHistoryPath) {
    this.path = path;
    this.historyPath = historyPath;
    this.database = null;
  }

  async open() {
    if (this.database) return this;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.path);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
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
      const content = textBlocks(message.content).trim();
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

  filters(input, values) {
    const clauses = [];
    if (Array.isArray(input.entryTypes) && input.entryTypes.length > 0) {
      const types = input.entryTypes.filter((type) => ["navigation", "conversation"].includes(type));
      if (types.length > 0) {
        clauses.push(`e.entry_type IN (${types.map(() => "?").join(",")})`);
        values.push(...types);
      }
    }
    if (typeof input.urlPrefix === "string" && input.urlPrefix) {
      clauses.push("e.url LIKE ?");
      values.push(`${input.urlPrefix}%`);
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

  async search(input) {
    await this.open();
    const terms = ftsTerms(input.query);
    const match = terms.join(" AND ");
    if (!match) return { query: input.query ?? "", results: [] };
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
    let rows = run(match);
    let matchMode = "all-terms";
    if (rows.length === 0 && terms.length > 1) {
      rows = run(terms.join(" OR "));
      matchMode = "best-effort";
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
      rows = this.database.prepare(`
        SELECT * FROM entries
        WHERE uri IN (${uris.map(() => "?").join(",")})
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(...uris, limit);
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
