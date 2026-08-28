import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appsStatePath } from "./paths.js";

const profilePattern = /^[^/\\\0]{1,120}$/;
const connectorPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/i;

function cleanProfileID(value) {
  const profileID = typeof value === "string" && profilePattern.test(value.trim())
    ? value.trim()
    : "Default";
  return profileID;
}

function cleanConnectorID(value) {
  if (typeof value !== "string" || !connectorPattern.test(value)) {
    throw new Error("invalid connector id");
  }
  return value;
}

async function atomicWriteJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function defaultState() {
  return {
    version: 1,
    advancedChat: { enabled: true, entitledLocally: true },
    morningBrief: {
      enabledProfileID: null,
      windowStartHour: 5,
      windowEndHour: 11,
      runs: {},
    },
    nativeConnections: {},
    bridgeConnections: {},
  };
}

function normalizeState(raw) {
  const initial = defaultState();
  const rawEnabledProfileID = raw?.morningBrief?.enabledProfileID;
  const enabledProfileID = typeof rawEnabledProfileID === "string"
    ? cleanProfileID(rawEnabledProfileID)
    : null;
  return {
    ...initial,
    advancedChat: { enabled: true, entitledLocally: true },
    morningBrief: {
      ...initial.morningBrief,
      enabledProfileID,
      runs: raw?.morningBrief?.runs && typeof raw.morningBrief.runs === "object"
        ? raw.morningBrief.runs
        : {},
    },
    nativeConnections: raw?.nativeConnections && typeof raw.nativeConnections === "object"
      ? raw.nativeConnections
      : {},
    bridgeConnections: raw?.bridgeConnections && typeof raw.bridgeConnections === "object"
      ? raw.bridgeConnections
      : {},
  };
}

function localDay(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class AppsStateStore {
  constructor(path = appsStatePath, { now = () => new Date() } = {}) {
    this.path = path;
    this.now = now;
    this.value = null;
  }

  async load() {
    if (this.value) return this.value;
    try {
      this.value = normalizeState(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.value = defaultState();
    }
    await atomicWriteJSON(this.path, this.value);
    return this.value;
  }

  async save() {
    await atomicWriteJSON(this.path, this.value);
    return this.value;
  }

  async setMorningBrief({ enabled, profileID = "Default" }) {
    if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
    const state = await this.load();
    const selectedProfile = cleanProfileID(profileID);
    state.morningBrief.enabledProfileID = enabled
      ? selectedProfile
      : state.morningBrief.enabledProfileID === selectedProfile
        ? null
        : state.morningBrief.enabledProfileID;
    return this.save();
  }

  async updateNativeState(payload) {
    const state = await this.load();
    const profileID = cleanProfileID(payload?.profileID);
    const connections = {};
    for (const item of Array.isArray(payload?.connectors) ? payload.connectors : []) {
      try {
        const id = cleanConnectorID(item?.id);
        connections[id] = {
          connected: item?.connected === true,
          autoConnected: item?.autoConnected === true,
          accountLabel: typeof item?.accountLabel === "string"
            ? item.accountLabel.slice(0, 200)
            : null,
          capabilities: Array.isArray(item?.capabilities)
            ? item.capabilities.filter((value) => typeof value === "string").slice(0, 100)
            : [],
          observedAt: this.now().toISOString(),
        };
      } catch {
        // Ignore malformed rows rather than allowing one native observation to
        // erase the other browser-local connection states.
      }
    }
    state.nativeConnections[profileID] = connections;
    return this.save();
  }

  morningBriefStatus(profileID = "Default") {
    if (!this.value) throw new Error("apps state has not been loaded");
    const selectedProfile = cleanProfileID(profileID);
    const now = this.now();
    const day = localDay(now);
    const candidateRun = this.value.morningBrief.runs[day] ?? null;
    const run = candidateRun?.profileID === selectedProfile ? candidateRun : null;
    const enabled = this.value.morningBrief.enabledProfileID === selectedProfile;
    const afterWindowStart = now.getHours() >= this.value.morningBrief.windowStartHour;
    const finished = run?.status === "succeeded";
    const pending = run?.status === "running" &&
      Date.parse(run.updatedAt ?? 0) > now.getTime() - 30 * 60_000;
    return {
      enabled,
      eligible: true,
      profileID: selectedProfile,
      enabledProfileID: this.value.morningBrief.enabledProfileID,
      localDay: day,
      windowStartHour: this.value.morningBrief.windowStartHour,
      windowEndHour: this.value.morningBrief.windowEndHour,
      due: enabled && afterWindowStart && !finished && !pending,
      run,
    };
  }

  async recordMorningBrief({ profileID = "Default", status, diagnostics = [] }) {
    if (!["running", "succeeded", "failed"].includes(status)) {
      throw new Error("invalid Morning Brief status");
    }
    const state = await this.load();
    const selectedProfile = cleanProfileID(profileID);
    if (state.morningBrief.enabledProfileID !== selectedProfile) {
      throw new Error("Morning Brief is not enabled for this profile");
    }
    const now = this.now();
    const day = localDay(now);
    const previous = state.morningBrief.runs[day];
    state.morningBrief.runs[day] = {
      profileID: selectedProfile,
      status,
      attempts: status === "running" ? (previous?.attempts ?? 0) + 1 : previous?.attempts ?? 1,
      updatedAt: now.toISOString(),
      diagnostics: Array.isArray(diagnostics)
        ? diagnostics.filter((item) => typeof item === "string").slice(0, 50)
        : [],
    };
    return this.save();
  }

  async publicState(profileID = "Default") {
    const state = await this.load();
    return {
      version: state.version,
      advancedChat: state.advancedChat,
      profileID: cleanProfileID(profileID),
      morningBrief: this.morningBriefStatus(profileID),
      nativeConnections: state.nativeConnections[cleanProfileID(profileID)] ?? {},
      bridgeConnections: state.bridgeConnections,
    };
  }
}

export { cleanConnectorID, cleanProfileID, localDay };
