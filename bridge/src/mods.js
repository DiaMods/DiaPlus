const configuredValue = process.env.DIA_CUSTOM_MODS ?? process.env.DIA_CUSTOM_MODULES;
const configured = typeof configuredValue === "string" && configuredValue.trim()
  ? new Set(configuredValue.split(",").map((value) => value.trim()).filter(Boolean))
  : null;

export function modEnabled(id) {
  // Direct bridge tests and older launchers omit the variable and retain the
  // historical all-enabled behavior. The production launcher supplies the
  // exact profile-resolved Dia Mods list.
  return configured === null || configured.has(id);
}

export function enabledModIDs() {
  return configured === null ? null : [...configured].sort();
}

// Compatibility exports for third-party experiments built against the old name.
export const moduleEnabled = modEnabled;
export const enabledModuleIDs = enabledModIDs;
