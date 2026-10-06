import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  legacyModulesStatePath,
  compatibilityStatePath,
  modsManifestPath,
  modsStatePath,
} from "./paths.js";
import { enabledModIDs } from "./mods.js";

async function loadJSON(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class ModConfigStore {
  constructor({
    manifestPath = modsManifestPath,
    statePath = modsStatePath,
    legacyStatePath = legacyModulesStatePath,
    activeModIDs = enabledModIDs(),
    compatibilityPath = compatibilityStatePath,
  } = {}) {
    this.manifestPath = manifestPath;
    this.statePath = statePath;
    this.legacyStatePath = legacyStatePath;
    this.activeModIDs = activeModIDs === null ? null : new Set(activeModIDs);
    this.compatibilityPath = compatibilityPath;
    this.manifest = null;
  }

  async loadManifest() {
    if (this.manifest !== null) return this.manifest;
    const manifest = await loadJSON(this.manifestPath, null);
    if (!manifest || !Array.isArray(manifest.mods)) {
      throw new Error("invalid Dia Mods manifest");
    }
    const ids = new Set();
    for (const mod of manifest.mods) {
      if (typeof mod?.id !== "string" || ids.has(mod.id) ||
          typeof mod?.label !== "string" || !Array.isArray(mod?.scope)) {
        throw new Error("invalid or duplicate Dia Mod entry");
      }
      ids.add(mod.id);
    }
    this.manifest = manifest;
    return manifest;
  }

  async loadState() {
    return loadJSON(
      this.statePath,
      await loadJSON(this.legacyStatePath, { version: 1, overrides: {} }),
    );
  }

  async publicState() {
    const [manifest, state, compatibility] = await Promise.all([
      this.loadManifest(),
      this.loadState(),
      loadJSON(this.compatibilityPath, { perMod: [] }),
    ]);
    const compatibilityByID = new Map(
      (compatibility?.perMod ?? []).map((entry) => [entry.id, entry]),
    );
    const mods = manifest.mods.map((mod) => {
      const override = state?.overrides?.[mod.id];
      const configuredEnabled = mod.required ||
        (typeof override === "boolean" ? override : mod.defaultEnabled !== false);
      const active = this.activeModIDs === null
        ? configuredEnabled
        : this.activeModIDs.has(mod.id);
      const modCompatibility = compatibilityByID.get(mod.id);
      const auditPending = mod.availability === "pending-audit";
      const unavailable = auditPending || modCompatibility?.compatible === false;
      return {
        ...mod,
        configuredEnabled,
        active: !auditPending && active,
        pending: !unavailable && active !== configuredEnabled,
        unavailable,
        compatibilityReason: auditPending ? mod.availabilityReason ?? "Native feature audit is pending" :
          unavailable ? modCompatibility.reason ?? "Incompatible with this Dia build" : null,
        source: mod.required ? "required" :
          typeof override === "boolean" ? "profile" : "default",
        apply: mod.rebuildOnChange ? "rebuild" : "restart",
      };
    });
    const byID = new Map(mods.map((mod) => [mod.id, mod]));
    for (const mod of mods.filter((candidate) => candidate.configuredEnabled)) {
      for (const id of mod.requires ?? []) {
        if (!byID.get(id)?.configuredEnabled) {
          throw new Error(`${mod.id} requires Dia Mod ${id}`);
        }
      }
      for (const id of new Set([...(mod.conflicts ?? []), ...(mod.replaces ?? [])])) {
        if (byID.get(id)?.configuredEnabled) {
          throw new Error(`${mod.id} conflicts with Dia Mod ${id}`);
        }
      }
    }
    return {
      version: 1,
      title: "Dia Mods",
      restartRequired: mods.some((mod) => mod.pending && !mod.rebuildOnChange),
      rebuildRequired: mods.some((mod) => mod.pending && mod.rebuildOnChange),
      unavailableMods: mods.filter((mod) => mod.unavailable).map((mod) => mod.id),
      mods,
    };
  }

  async setEnabled(id, enabled) {
    if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
    const manifest = await this.loadManifest();
    const mod = manifest.mods.find((candidate) => candidate.id === id);
    if (!mod) throw new Error(`unknown Dia Mod: ${id}`);
    if (enabled && mod.availability === "pending-audit") {
      throw new Error(`${mod.label}: ${mod.availabilityReason ?? "Native feature audit is pending"}`);
    }
    if (mod.required && !enabled) {
      throw new Error(`${id} is a required safety/core mod and cannot be disabled`);
    }
    const state = await this.loadState();
    const overrides = { ...(state?.overrides ?? {}), [id]: enabled };
    if (enabled) {
      for (const dependency of mod.requires ?? []) overrides[dependency] = true;
      for (const conflict of new Set([
        ...(mod.conflicts ?? []),
        ...(mod.replaces ?? []),
      ])) overrides[conflict] = false;
      for (const candidate of manifest.mods) {
        if ((candidate.conflicts ?? []).includes(id) ||
            (candidate.replaces ?? []).includes(id)) {
          overrides[candidate.id] = false;
        }
      }
    } else {
      for (const replaced of mod.replaces ?? []) overrides[replaced] = true;
    }
    await atomicWriteJSON(this.statePath, {
      version: 1,
      overrides,
    });
    return this.publicState();
  }
}
