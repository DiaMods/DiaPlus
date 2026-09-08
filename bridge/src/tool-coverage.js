import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { toolCoveragePath } from "./paths.js";

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function schemaHash(tool) {
  return createHash("sha256")
    .update(JSON.stringify(tool.input_schema ?? {}))
    .digest("hex");
}

export class ToolCoverageStore {
  constructor(path = toolCoveragePath) {
    this.path = path;
    this.value = null;
    this.loading = null;
    this.recordQueue = Promise.resolve();
  }

  async load() {
    if (this.value) return this.value;
    if (!this.loading) {
      this.loading = this.readStoredValue().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  async readStoredValue() {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      this.value = {
        version: 1,
        tools: raw?.tools && typeof raw.tools === "object" ? raw.tools : {},
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.value = { version: 1, tools: {} };
    }
    return this.value;
  }

  async record(nativeTools, routedTools) {
    // New-tab metadata jobs and chat requests can record tools concurrently.
    // Serialize the complete read/update/write transaction to keep both sets.
    const pending = this.recordQueue.then(() => this.recordNow(nativeTools, routedTools));
    this.recordQueue = pending.catch(() => {});
    return pending;
  }

  async recordNow(nativeTools, routedTools) {
    const value = await this.load();
    const now = new Date().toISOString();
    const nativeByName = new Map((nativeTools ?? [])
      .filter((tool) => typeof tool?.name === "string")
      .map((tool) => [tool.name, tool]));
    const routedByName = new Map((routedTools ?? [])
      .filter((tool) => typeof tool?.name === "string")
      .map((tool) => [tool.name, tool]));
    const names = new Set([...nativeByName.keys(), ...routedByName.keys()]);
    for (const name of names) {
      const routed = routedByName.get(name);
      const observed = nativeByName.get(name);
      const tool = routed ?? observed;
      if (typeof tool?.name !== "string") continue;
      const previous = value.tools[tool.name];
      const schema = tool.source === "deferred" && previous?.inputSchema
        ? previous.inputSchema
        : tool.input_schema && typeof tool.input_schema === "object"
          ? tool.input_schema
          : {};
      value.tools[tool.name] = {
        name: tool.name,
        route: routed
          ? (routed.source === "local" ? "local" : "native")
          : observed.source === "deferred" ? "deferred" : "blocked",
        nativeSeen: Boolean(observed) || previous?.nativeSeen === true,
        description: tool.source === "deferred" && previous?.description
          ? previous.description
          : typeof tool.description === "string" ? tool.description : "",
        inputSchema: schema,
        schemaHash: schemaHash({ input_schema: schema }),
        firstSeen: previous?.firstSeen ?? now,
        lastSeen: now,
      };
    }
    await atomicWrite(this.path, value);
    return this.publicValue();
  }

  async publicValue() {
    const value = await this.load();
    const tools = Object.values(value.tools).sort((left, right) =>
      left.name.localeCompare(right.name));
    return {
      version: 1,
      total: tools.length,
      native: tools.filter((tool) => tool.route === "native").length,
      local: tools.filter((tool) => tool.route === "local").length,
      deferred: tools.filter((tool) => tool.route === "deferred").length,
      blocked: tools.filter((tool) => tool.route === "blocked").length,
      tools,
    };
  }
}
