const configuredValue = process.env.DIA_CUSTOM_MODS ?? process.env.DIA_CUSTOM_MODULES;
const configured = typeof configuredValue === "string" && configuredValue.trim()
  ? new Set(configuredValue.split(",").map((value) => value.trim()).filter(Boolean))
  : null;

export function modEnabled(id) {
  // Direct bridge tests and older launchers omit the variable and retain the
  // historical enabled behavior for established mods, not new default-off
  // experiments. The production launcher supplies the exact profile-resolved
  // Dia Mods list; pending audits remain blocked even under a forced list.
  return !pendingAudit.has(id) && (configured === null ? !defaultOff.has(id) : configured.has(id));
}

export function enabledModIDs() {
  return configured === null ? null : [...configured].filter(id => !pendingAudit.has(id)).sort();
}

// Compatibility exports for third-party experiments built against the old name.
export const moduleEnabled = modEnabled;
export const enabledModuleIDs = enabledModIDs;
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL('../config/dia-mods.json', import.meta.url), 'utf8'));
const defaultOff = new Set(manifest.mods.filter(mod => mod.defaultEnabled === false).map(mod => mod.id));
const pendingAudit = new Set(manifest.mods.filter(mod => mod.availability === 'pending-audit').map(mod => mod.id));
