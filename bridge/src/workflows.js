import { randomUUID, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stateDirectory } from "./paths.js";
import { requireLocalProfile } from "./knowledge.js";
import { modEnabled } from "./mods.js";

const maximumSchedules = 100;
const runHistoryLimit = 100;
const missedGraceMs = 60_000;

function validateSchedule(input, now, existing = null) {
  const profileID = requireLocalProfile(input.profileID);
  const id = input.id ?? randomUUID();
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error("Invalid workflow ID");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 300) throw new Error("Workflow title must contain 1–300 characters");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 16000) throw new Error("Workflow prompt must contain 1–16000 characters");
  if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 525600) throw new Error("Workflow intervalMinutes must be 5–525600");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Workflow enabled must be boolean");
  const enabled = input.enabled ?? false;
  const unchangedCadence = existing?.enabled && enabled && existing.intervalMinutes === input.intervalMinutes;
  return { ...existing, id, profileID, title: input.title.trim(), prompt: input.prompt.trim(),
    intervalMinutes: input.intervalMinutes, enabled,
    nextRun: enabled ? unchangedCadence ? existing.nextRun : now + input.intervalMinutes * 60_000 : null,
    updatedAt: now, createdAt: existing?.createdAt ?? now, lastStatus: existing?.lastStatus ?? "never" };
}

export class LocalWorkflows {
  constructor({ path = resolve(stateDirectory, "workflows.json"), runResearch, now = () => Date.now(), enabled = () => modEnabled("local-workflows") && modEnabled("local-knowledge") } = {}) {
    this.path = path;
    this.runResearch = runResearch;
    this.now = now;
    this.enabled = enabled;
    this.state = null;
    this.loading = null;
    this.mutations = Promise.resolve();
    this.active = new Map();
    this.timer = null;
    this.ticking = false;
  }

  async load() {
    if (this.loading) return this.loading;
    if (this.state) return this.state;
    this.loading = (async () => {
      let value = { version: 1, workflows: [], runs: [] };
      try {
        if ((await stat(this.path)).size > 4 * 1024 * 1024) throw new Error("Workflow state exceeds 4 MiB");
        value = JSON.parse(await readFile(this.path, "utf8"));
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (value.version !== 1 || !Array.isArray(value.workflows) || !Array.isArray(value.runs) || value.workflows.length > maximumSchedules) throw new Error("Invalid workflow state");
      this.state = { version: 1, workflows: [], runs: value.runs.slice(-runHistoryLimit) };
      for (const raw of value.workflows) {
        const workflow = validateSchedule(raw, this.now(), raw);
        if (workflow.enabled && (!Number.isFinite(workflow.nextRun) || workflow.nextRun <= this.now())) {
          workflow.nextRun = this.now() + workflow.intervalMinutes * 60_000;
          workflow.lastStatus = "skipped";
          workflow.lastError = "Missed run skipped while Dia Custom was closed";
        }
        if (workflow.lastStatus === "running") {
          workflow.lastStatus = "interrupted";
          workflow.lastError = "Previous run was interrupted when Dia Custom closed";
        }
        this.state.workflows.push(workflow);
      }
      for (const run of this.state.runs) if (run.status === "running") {
        run.status = "interrupted"; run.error = "Run was interrupted when Dia Custom closed"; run.finishedAt = this.now();
      }
      return this.state;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  async persist() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.path), 0o700);
    const temporary = `${this.path}.tmp-${randomBytes(8).toString("hex")}`;
    try {
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }

  mutate(operation) {
    const pending = this.mutations.then(async () => { await this.load(); const result = await operation(); await this.persist(); return result; });
    this.mutations = pending.catch(() => {});
    return pending;
  }

  async list({ profileID = "Default" } = {}) {
    const profile = requireLocalProfile(profileID);
    await this.load();
    return { workflows: structuredClone(this.state.workflows.filter((workflow) => workflow.profileID === profile)) };
  }

  async runs({ profileID = "Default" } = {}) {
    const profile = requireLocalProfile(profileID);
    await this.load();
    return { runs: structuredClone(this.state.runs.filter((run) => run.profileID === profile).toReversed()) };
  }

  async save(input) {
    return this.mutate(() => {
      const profileID = requireLocalProfile(input.profileID);
      const existing = this.state.workflows.find((item) => item.id === input.id && item.profileID === profileID);
      if (!existing && this.state.workflows.length >= maximumSchedules) throw new Error("The local workflow limit is 100 schedules");
      const workflow = validateSchedule(input, this.now(), existing);
      this.state.workflows = this.state.workflows.filter((item) => !(item.id === workflow.id && item.profileID === profileID));
      this.state.workflows.push(workflow);
      return { workflow: structuredClone(workflow) };
    });
  }

  async remove(id, { profileID = "Default" } = {}) {
    return this.mutate(() => {
      const profile = requireLocalProfile(profileID);
      const length = this.state.workflows.length;
      this.state.workflows = this.state.workflows.filter((workflow) => !(workflow.id === id && workflow.profileID === profile));
      return { deleted: length - this.state.workflows.length };
    });
  }

  async startRun({ profileID = "Default", title = "Research", prompt, workflowID = null, scheduled = false }) {
    if (!this.enabled()) throw new Error("Local workflows or knowledge mod is disabled");
    if (typeof this.runResearch !== "function") throw new Error("The research runner is unavailable");
    const profile = requireLocalProfile(profileID);
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 16000) throw new Error("Research prompt must contain 1–16000 characters");
    if (typeof title !== "string" || !title.trim() || title.length > 300) throw new Error("Research title must contain 1–300 characters");
    const key = JSON.stringify([profile, workflowID ?? "manual-research"]);
    if (this.active.has(key)) throw new Error("This workflow already has a running job");
    if (this.active.size >= 3) throw new Error("Three local research jobs are already running");
    const job = { id: randomUUID(), profileID: profile, workflowID, title: title.trim(), scheduled,
      status: "running", startedAt: this.now(), finishedAt: null, documentID: null, error: null };
    // Reserve before any asynchronous state write so simultaneous clicks cannot overlap.
    const active = { job, promise: null };
    this.active.set(key, active);
    try {
      await this.mutate(() => {
        const workflow = workflowID ? this.state.workflows.find((item) => item.id === workflowID && item.profileID === profile) : null;
        if (workflowID && !workflow) throw new Error("Unknown workflow for this profile");
        if (scheduled && !workflow.enabled) throw new Error("Workflow was disabled before it ran");
        if (workflow) {
          workflow.lastStatus = "running";
          workflow.lastRun = this.now();
          workflow.lastError = null;
          if (workflow.enabled) workflow.nextRun = this.now() + workflow.intervalMinutes * 60_000;
        }
        this.state.runs.push(job);
        this.state.runs = this.state.runs.slice(-runHistoryLimit);
      });
    } catch (error) { this.active.delete(key); throw error; }
    active.promise = (async () => {
      try {
        const output = await this.runResearch({ profileID: profile, title: job.title, prompt: prompt.trim(), scheduled });
        await this.finish(job, { status: "succeeded", documentID: output.document?.id ?? output.documentID ?? null });
      } catch (error) {
        await this.finish(job, { status: "failed", error: String(error?.message ?? error).slice(0, 1000) });
      }
    })().catch((error) => { job.status = "failed"; job.error = `Could not persist run status: ${String(error.message).slice(0, 500)}`; })
      .finally(() => { if (this.active.get(key) === active) this.active.delete(key); });
    return { job: structuredClone(job) };
  }

  async finish(job, patch) {
    return this.mutate(() => {
      Object.assign(job, patch, { finishedAt: this.now() });
      const workflow = this.state.workflows.find((item) => item.id === job.workflowID && item.profileID === job.profileID);
      if (workflow) {
        workflow.lastStatus = job.status; workflow.lastError = job.error;
        if (job.documentID) workflow.lastDocumentID = job.documentID;
      }
    });
  }

  async research(input) { return this.startRun(input); }

  async run(id, { profileID = "Default", scheduled = false } = {}) {
    await this.load();
    const profile = requireLocalProfile(profileID);
    const workflow = this.state.workflows.find((item) => item.id === id && item.profileID === profile);
    if (!workflow) throw new Error("Unknown workflow for this profile");
    return this.startRun({ profileID: profile, title: workflow.title, prompt: workflow.prompt, workflowID: id, scheduled });
  }

  async tick() {
    if (this.ticking || !this.enabled()) return;
    this.ticking = true;
    try {
      await this.load();
      for (const workflow of [...this.state.workflows]) {
        if (!workflow.enabled || workflow.nextRun > this.now()) continue;
        const busy = this.active.has(JSON.stringify([workflow.profileID, workflow.id])) || this.active.size >= 3;
        if (busy || this.now() - workflow.nextRun > missedGraceMs) {
          await this.mutate(() => {
            workflow.nextRun = this.now() + workflow.intervalMinutes * 60_000;
            if (!busy) workflow.lastStatus = "skipped";
            workflow.lastSkip = this.now();
          });
          continue;
        }
        await this.run(workflow.id, { profileID: workflow.profileID, scheduled: true }).catch(async (error) => {
          await this.mutate(() => { workflow.lastStatus = "failed"; workflow.lastError = String(error.message).slice(0, 1000); workflow.nextRun = this.now() + workflow.intervalMinutes * 60_000; });
        });
      }
    } finally { this.ticking = false; }
  }

  async start() {
    if (this.timer || !this.enabled()) return;
    await this.load();
    // Persist restart recovery without immediately running missed jobs.
    await this.mutate(() => {});
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 30_000);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  async waitForIdle() { await Promise.all([...this.active.values()].map((item) => item.promise)); }
}

export async function handleWorkflowAPI(request, response, url, { manager, hasAdminToken, readBody, jsonResponse }) {
  const knowledge = url.pathname.match(/^\/api\/knowledge(?:\/([^/]+))?$/);
  const workflow = url.pathname.match(/^\/api\/workflows(?:\/([^/]+)(?:\/(run))?)?$/);
  const research = url.pathname === "/api/research";
  if (!knowledge && !workflow && !research) return false;
  try {
    if (!await hasAdminToken(request)) { jsonResponse(response, 403, { error: "invalid local administration token" }); return true; }
    if (knowledge && !modEnabled("local-knowledge")) throw new Error("local-knowledge mod is disabled");
    if (!knowledge && (!modEnabled("local-workflows") || !modEnabled("local-knowledge"))) throw new Error("local-workflows or local-knowledge mod is disabled");
    const body = ["POST", "PUT"].includes(request.method) ? JSON.parse((await readBody(request)).toString("utf8") || "{}") : {};
    const profileID = requireLocalProfile(body.profileID ?? url.searchParams.get("profileID") ?? "Default");
    let value;
    if (knowledge) {
      const id = knowledge[1] ? decodeURIComponent(knowledge[1]) : null;
      if (request.method === "GET") value = id ? await manager.knowledgeStore.read({ profileID, ids: [id] }) : await manager.knowledgeStore.list({ profileID });
      else if (request.method === "POST" && !id) value = await manager.knowledgeStore.import({ ...body, profileID });
      else if (request.method === "DELETE" && id) value = await manager.knowledgeStore.remove({ profileID, id });
      else { jsonResponse(response, 405, { error: "method_not_allowed" }); return true; }
    } else if (research && request.method === "POST") value = await manager.workflows.research({ profileID, title: body.title ?? "Research", prompt: body.prompt });
    else if (workflow) {
      const id = workflow[1] ? decodeURIComponent(workflow[1]) : null;
      if (request.method === "GET" && id === "runs") value = await manager.workflows.runs({ profileID });
      else if (request.method === "GET" && !id) value = await manager.workflows.list({ profileID });
      else if (request.method === "POST" && !id) value = await manager.workflows.save({ ...body, profileID });
      else if (request.method === "POST" && workflow[2]) value = await manager.workflows.run(id, { profileID });
      else if (request.method === "DELETE" && id) value = await manager.workflows.remove(id, { profileID });
      else { jsonResponse(response, 405, { error: "method_not_allowed" }); return true; }
    } else { jsonResponse(response, 405, { error: "method_not_allowed" }); return true; }
    jsonResponse(response, value?.job ? 202 : 200, value);
  } catch (error) { jsonResponse(response, 400, { error: String(error?.message ?? error) }); }
  return true;
}
