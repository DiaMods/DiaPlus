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
    version: 4,
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

function normalizeMorningBriefRuns(rawRuns) {
  if (!rawRuns || typeof rawRuns !== "object" || Array.isArray(rawRuns)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(rawRuns)) {
    if (value?.profileID && value?.status) {
      const profileID = cleanProfileID(value.profileID);
      normalized[profileID] = { ...(normalized[profileID] ?? {}), [key]: value };
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const profileID = cleanProfileID(key);
    normalized[profileID] = Object.fromEntries(Object.entries(value)
      .filter(([day, run]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && run?.status));
  }
  return normalized;
}

function normalizeState(raw) {
  const initial = defaultState();
  const rawEnabledProfileID = raw?.morningBrief?.enabledProfileID;
  const enabledProfileID = typeof rawEnabledProfileID === "string"
    ? cleanProfileID(rawEnabledProfileID)
    : null;
  const rawConnections = raw?.bridgeConnections && typeof raw.bridgeConnections === "object" && !Array.isArray(raw.bridgeConnections)
    ? raw.bridgeConnections : {};
  const profiles = Object.values(rawConnections).some((value) => value?.connected !== undefined)
    ? { Default: rawConnections } : rawConnections;
  const bridgeConnections = Object.fromEntries(Object.entries(profiles).filter(([, rows]) =>
    rows && typeof rows === "object" && !Array.isArray(rows)).map(([profileID, rows]) => [profileID,
    Object.fromEntries(Object.entries(rows).filter(([, row]) => row && typeof row === "object").map(([id, row]) => [id, {
      ...row,
      // Older releases used connected for both intent and runtime health. Only
      // a previously connected row opts into restoration during migration.
      desiredConnected: typeof row.desiredConnected === "boolean" ? row.desiredConnected : row.connected === true,
    }])),
  ]));
  return {
    ...initial,
    advancedChat: { enabled: true, entitledLocally: true },
    morningBrief: {
      ...initial.morningBrief,
      enabledProfileID,
      runs: normalizeMorningBriefRuns(raw?.morningBrief?.runs),
    },
    nativeConnections: raw?.nativeConnections && typeof raw.nativeConnections === "object"
      ? raw.nativeConnections
      : {},
    bridgeConnections,
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
    this.loading = null;
    this.pendingSave = Promise.resolve();
  }

  async load() {
    if (this.loading) return this.loading;
    if (this.value) return this.value;
    this.loading = this.loadFile().finally(() => { this.loading = null; });
    return this.loading;
  }

  async loadFile() {
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
    const snapshot = structuredClone(this.value);
    const pending = this.pendingSave.then(() => atomicWriteJSON(this.path, snapshot));
    this.pendingSave = pending.catch(() => {});
    await pending;
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
    const existingConnections = state.nativeConnections[profileID] ?? {};
    for (const item of Array.isArray(payload?.connectors) ? payload.connectors : []) {
      try {
        const id = cleanConnectorID(item?.id);
        connections[id] = {
          ...(existingConnections[id] ?? {}),
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

  async updateNativeConnection(profileID, connectorID, patch = {}) {
    const state = await this.load();
    const selectedProfile = cleanProfileID(profileID);
    const id = cleanConnectorID(connectorID);
    const current = state.nativeConnections[selectedProfile]?.[id] ?? {};
    state.nativeConnections[selectedProfile] = {
      ...(state.nativeConnections[selectedProfile] ?? {}),
      [id]: {
        ...current,
        ...patch,
        accountLabel: typeof patch.accountLabel === "string"
          ? patch.accountLabel.slice(0, 200)
          : current.accountLabel ?? null,
        capabilities: Array.isArray(patch.capabilities)
          ? patch.capabilities.filter((value) => typeof value === "string").slice(0, 100)
          : current.capabilities ?? [],
        lastError: typeof patch.lastError === "string"
          ? patch.lastError.slice(0, 500)
          : patch.lastError === null ? null : current.lastError ?? null,
        observedAt: this.now().toISOString(),
      },
    };
    return this.save();
  }

  async updateBridgeConnection(profileID, connectorID, patch = {}) {
    const state = await this.load();
    const selectedProfile = cleanProfileID(profileID);
    const id = cleanConnectorID(connectorID);
    const profiles = state.bridgeConnections;
    const current = profiles[selectedProfile]?.[id] ?? {};
    profiles[selectedProfile] = {
      ...(profiles[selectedProfile] ?? {}),
      [id]: {
        ...current,
        desiredConnected: patch.desiredConnected ?? current.desiredConnected ?? patch.connected ?? false,
        connected: patch.connected ?? current.connected ?? false,
        connectionState: patch.connectionState ?? current.connectionState ?? "disconnected",
        authenticated: patch.authenticated ?? current.authenticated ?? false,
        executionReady: patch.executionReady ?? current.executionReady ?? false,
        accountLabel: typeof patch.accountLabel === "string"
          ? patch.accountLabel.slice(0, 200)
          : current.accountLabel ?? null,
        lastSuccess: typeof patch.lastSuccess === "string"
          ? patch.lastSuccess
          : current.lastSuccess ?? null,
        lastError: typeof patch.lastError === "string"
          ? patch.lastError.slice(0, 500)
          : patch.lastError === null ? null : current.lastError ?? null,
        sparkVersion: typeof patch.sparkVersion === "string" ? patch.sparkVersion.slice(0, 100) : current.sparkVersion ?? null,
        syncCursor: typeof patch.syncCursor === "string" ? patch.syncCursor.slice(0, 16000) : patch.syncCursor === null ? null : current.syncCursor ?? null,
        lastSync: typeof patch.lastSync === "string" ? patch.lastSync : patch.lastSync === null ? null : current.lastSync ?? null,
        lastSyncError: typeof patch.lastSyncError === "string" ? patch.lastSyncError.slice(0, 500) : patch.lastSyncError === null ? null : current.lastSyncError ?? null,
        observedAt: this.now().toISOString(),
      },
    };
    return this.save();
  }

  morningBriefStatus(profileID = "Default") {
    if (!this.value) throw new Error("apps state has not been loaded");
    const selectedProfile = cleanProfileID(profileID);
    const now = this.now();
    const day = localDay(now);
    const profileRuns = this.value.morningBrief.runs[selectedProfile] ?? {};
    const run = profileRuns[day] ?? null;
    const enabled = this.value.morningBrief.enabledProfileID === selectedProfile;
    const withinMorningWindow = now.getHours() >= this.value.morningBrief.windowStartHour &&
      now.getHours() < this.value.morningBrief.windowEndHour;
    // A native report can remain "running" when no ingestion callback arrives.
    // Any recorded attempt consumes today's automatic run; elapsed time must
    // never turn an unfinished or failed report into another scheduled brief.
    const controllerAvailable = run?.stage !== "native-controller-incompatible";
    return {
      enabled,
      eligible: true,
      available: controllerAvailable,
      ...(controllerAvailable ? {} : {
        compatibilityReason: "Dia's native Morning Brief controller is unavailable for this build.",
      }),
      profileID: selectedProfile,
      enabledProfileID: this.value.morningBrief.enabledProfileID,
      localDay: day,
      windowStartHour: this.value.morningBrief.windowStartHour,
      windowEndHour: this.value.morningBrief.windowEndHour,
      due: enabled && withinMorningWindow && run === null,
      run,
      lastSuccess: Object.entries(profileRuns)
        .filter(([, value]) => value?.status === "succeeded")
        .sort(([left], [right]) => right.localeCompare(left))[0]?.[1] ?? null,
    };
  }

  async recordMorningBrief({
    profileID = "Default",
    status,
    diagnostics = [],
    stage = null,
    runID = null,
    reportID = null,
  }) {
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
    const profileRuns = state.morningBrief.runs[selectedProfile] ?? {};
    const previous = profileRuns[day];
    const sameRun = (typeof runID === "string" && runID && previous?.runID === runID) ||
      (status === "running" && previous?.status === "running");
    if (previous?.status === "succeeded" && status !== "succeeded") {
      return state;
    }
    state.morningBrief.runs[selectedProfile] = {
      ...profileRuns,
      [day]: {
      profileID: selectedProfile,
      status,
      attempts: status === "running" && !sameRun
        ? (previous?.attempts ?? 0) + 1
        : previous?.attempts ?? 1,
      updatedAt: now.toISOString(),
      ...(typeof runID === "string" && runID ? { runID } : previous?.runID ? { runID: previous.runID } : {}),
      ...(typeof stage === "string" && stage ? { stage } : previous?.stage ? { stage: previous.stage } : {}),
      ...(typeof reportID === "string" && reportID
        ? { reportID }
        : previous?.reportID ? { reportID: previous.reportID } : {}),
      diagnostics: Array.isArray(diagnostics)
        ? diagnostics.filter((item) => typeof item === "string").slice(0, 50)
        : [],
      },
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
      bridgeConnections: state.bridgeConnections[cleanProfileID(profileID)] ?? {},
    };
  }
}

export { cleanConnectorID, cleanProfileID, localDay };
