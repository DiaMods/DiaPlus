import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stateDirectory } from "./paths.js";
import { LocalWebTools } from "./local-tools/web.js";

export function requireLocalProfile(value = "Default") {
  if (typeof value !== "string" || !/^[^/\\\0]{1,120}$/.test(value.trim()) || value.trim() === "*") throw new Error("A valid profileID is required");
  return value.trim();
}

function sourceURL(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Knowledge sources must use HTTP(S) URLs without credentials");
  return url.toString();
}

function publicDocument(row, full = false) {
  return { id: row.id, profileID: row.profile_id, title: row.title,
    content: full ? row.content : row.content.slice(0, 900),
    truncated: !full && row.content.length > 900,
    url: row.source_url || null, provenance: JSON.parse(row.provenance),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

export class KnowledgeStore {
  constructor(path = resolve(stateDirectory, "knowledge.sqlite3"), { webTools = new LocalWebTools(), now = () => Date.now() } = {}) {
    this.path = path;
    this.webTools = webTools;
    this.now = now;
    this.database = null;
    this.opening = null;
  }

  async open() {
    if (this.opening) return this.opening;
    if (this.database) return this;
    this.opening = (async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      this.database = new DatabaseSync(this.path);
      this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS documents (
          row_id INTEGER PRIMARY KEY, id TEXT NOT NULL, profile_id TEXT NOT NULL,
          title TEXT NOT NULL, content TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '',
          provenance TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(profile_id,id)
        );
        CREATE INDEX IF NOT EXISTS documents_profile_time ON documents(profile_id,updated_at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(title,content,content='documents',content_rowid='row_id');
        CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
          INSERT INTO documents_fts(rowid,title,content) VALUES(new.row_id,new.title,new.content); END;
        CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts,rowid,title,content) VALUES('delete',old.row_id,old.title,old.content); END;
        CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts,rowid,title,content) VALUES('delete',old.row_id,old.title,old.content);
          INSERT INTO documents_fts(rowid,title,content) VALUES(new.row_id,new.title,new.content); END;`);
      await chmod(dirname(this.path), 0o700);
      for (const file of [this.path, `${this.path}-wal`, `${this.path}-shm`]) await chmod(file, 0o600).catch((error) => { if (error.code !== "ENOENT") throw error; });
      return this;
    })().finally(() => { this.opening = null; });
    return this.opening;
  }

  async import({ id, profileID = "Default", title, content, url, fileName, provenance } = {}) {
    const profile = requireLocalProfile(profileID);
    if (id !== undefined && (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))) throw new Error("Invalid knowledge document ID");
    let source = sourceURL(url);
    let origin = "text";
    let fetchedAt = null;
    if (content === undefined && source) {
      const page = (await this.webTools.fetchContent({ urls: [source] })).pages?.[0];
      if (page?.error || typeof page?.content !== "string") throw new Error(page?.error ?? "The URL did not return readable content");
      if (page.truncated) throw new Error("The web source exceeded the import limit; import a selected text excerpt instead");
      content = page.content;
      title ||= page.title;
      source = sourceURL(page.url);
      fetchedAt = new Date(this.now()).toISOString();
      origin = "web";
    }
    if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 1024 * 1024 || content.includes("\0")) throw new Error("Knowledge content must be text or Markdown, 1 byte–1 MiB");
    const label = typeof title === "string" && title.trim() ? title.trim().slice(0, 300) : typeof fileName === "string" && fileName ? fileName.slice(0, 300) : "Untitled note";
    const sources = Array.isArray(provenance?.sources) ? [...new Set(provenance.sources.slice(0, 100).map(sourceURL).filter(Boolean))] : source ? [source] : [];
    const evidence = { kind: provenance?.kind === "research" ? "research" : origin,
      sources, ...(fetchedAt ? { retrievedAt: fetchedAt } : {}),
      ...(typeof fileName === "string" ? { fileName: fileName.replaceAll("\\", "/").split("/").at(-1).slice(0, 300) } : {}),
      ...(typeof provenance?.prompt === "string" ? { prompt: provenance.prompt.slice(0, 16000) } : {}) };
    await this.open();
    const documentID = id ?? randomUUID();
    const existing = this.database.prepare("SELECT row_id FROM documents WHERE profile_id=? AND id=?").get(profile, documentID);
    if (!existing && Number(this.database.prepare("SELECT COUNT(*) AS count FROM documents WHERE profile_id=?").get(profile).count) >= 1000) throw new Error("This profile already has 1000 knowledge documents");
    const bytes = Number(this.database.prepare("SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM documents WHERE profile_id=? AND id!=?").get(profile, documentID).bytes);
    if (bytes + Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error("This profile's knowledge store exceeds 32 MiB; remove older documents first");
    this.database.prepare(`INSERT INTO documents(id,profile_id,title,content,source_url,provenance,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(profile_id,id) DO UPDATE SET title=excluded.title,content=excluded.content,source_url=excluded.source_url,provenance=excluded.provenance,updated_at=excluded.updated_at`)
      .run(documentID, profile, label, content, source ?? "", JSON.stringify(evidence), this.now(), this.now());
    return { document: (await this.read({ profileID: profile, ids: [documentID] })).documents[0] };
  }

  async list({ profileID = "Default" } = {}) {
    await this.open();
    const profile = requireLocalProfile(profileID);
    return { documents: this.database.prepare("SELECT * FROM documents WHERE profile_id=? ORDER BY updated_at DESC LIMIT 1000").all(profile).map((row) => publicDocument(row)) };
  }

  async search({ profileID = "Default", query, limit = 10 } = {}) {
    await this.open();
    const profile = requireLocalProfile(profileID);
    if (typeof query !== "string" || query.length > 4000) throw new Error("Knowledge search requires a query up to 4000 characters");
    const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 20).map((term) => `"${term}"`) ?? [];
    if (!terms.length) return { query, documents: [] };
    const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 10;
    const rows = this.database.prepare(`SELECT d.* FROM documents_fts JOIN documents d ON d.row_id=documents_fts.rowid
      WHERE documents_fts MATCH ? AND d.profile_id=? ORDER BY bm25(documents_fts,4,1),d.updated_at DESC LIMIT ?`)
      .all(terms.join(" OR "), profile, bounded);
    return { query, documents: rows.map((row) => publicDocument(row)) };
  }

  async read({ profileID = "Default", ids } = {}) {
    await this.open();
    const profile = requireLocalProfile(profileID);
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some((id) => typeof id !== "string" || id.length > 120)) throw new Error("Knowledge read requires 1–50 document IDs");
    return { documents: this.database.prepare(`SELECT * FROM documents WHERE profile_id=? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY updated_at DESC`)
      .all(profile, ...ids).map((row) => publicDocument(row, true)) };
  }

  async remove({ profileID = "Default", id } = {}) {
    await this.open();
    if (typeof id !== "string" || !id || id.length > 120) throw new Error("Invalid knowledge document ID");
    return { deleted: Number(this.database.prepare("DELETE FROM documents WHERE profile_id=? AND id=?").run(requireLocalProfile(profileID), id).changes) };
  }

  close() { this.database?.close(); this.database = null; }
}

export function localKnowledgeTools() {
  return [{ name: "mcp__dia-tools__knowledge_search", description: "Search text, Markdown, imported web sources and saved research in this Dia profile's local knowledge library. Returns excerpts and provenance; use knowledge_read for full documents.",
    input_schema: { type: "object", properties: { query: { type: "string", maxLength: 4000 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false }, source: "local", annotations: { readOnlyHint: true } },
  { name: "mcp__dia-tools__knowledge_read", description: "Read full documents by the IDs returned from knowledge_search, including original source URLs and citations. Access is limited to this Dia profile.",
    input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 } }, required: ["ids"], additionalProperties: false }, source: "local", annotations: { readOnlyHint: true } }];
}

export function isKnowledgeTool(name) { return localKnowledgeTools().some((tool) => tool.name === name); }
export async function executeKnowledgeTool(store, name, input, context = {}) {
  const options = { ...input, profileID: requireLocalProfile(context.profileID) };
  if (name === "mcp__dia-tools__knowledge_search") return store.search(options);
  if (name === "mcp__dia-tools__knowledge_read") return store.read(options);
  throw new Error("Unknown knowledge tool");
}
