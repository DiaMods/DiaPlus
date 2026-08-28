import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  legacyModulesStatePath,
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
  } = {}) {
    this.manifestPath = manifestPath;
    this.statePath = statePath;
    this.legacyStatePath = legacyStatePath;
    this.activeModIDs = activeModIDs === null ? null : new Set(activeModIDs);
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
    const [manifest, state] = await Promise.all([
      this.loadManifest(),
      this.loadState(),
    ]);
    const mods = manifest.mods.map((mod) => {
      const override = state?.overrides?.[mod.id];
      const configuredEnabled = mod.required ||
        (typeof override === "boolean" ? override : mod.defaultEnabled !== false);
      const active = this.activeModIDs === null
        ? configuredEnabled
        : this.activeModIDs.has(mod.id);
      return {
        ...mod,
        configuredEnabled,
        active,
        pending: active !== configuredEnabled,
        source: mod.required ? "required" :
          typeof override === "boolean" ? "profile" : "default",
        apply: mod.rebuildOnChange ? "rebuild" : "restart",
      };
    });
    return {
      version: 1,
      title: "Dia Mods",
      restartRequired: mods.some((mod) => mod.pending && !mod.rebuildOnChange),
      rebuildRequired: mods.some((mod) => mod.pending && mod.rebuildOnChange),
      mods,
    };
  }

  async setEnabled(id, enabled) {
    if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
    const manifest = await this.loadManifest();
    const mod = manifest.mods.find((candidate) => candidate.id === id);
    if (!mod) throw new Error(`unknown Dia Mod: ${id}`);
    if (mod.required && !enabled) {
      throw new Error(`${id} is a required safety/core mod and cannot be disabled`);
    }
    const state = await this.loadState();
    await atomicWriteJSON(this.statePath, {
      version: 1,
      overrides: { ...(state?.overrides ?? {}), [id]: enabled },
    });
    return this.publicState();
  }
}
