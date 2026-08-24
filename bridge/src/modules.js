const configured = typeof process.env.DIA_CUSTOM_MODULES === "string" &&
  process.env.DIA_CUSTOM_MODULES.trim()
  ? new Set(process.env.DIA_CUSTOM_MODULES.split(",").map((value) => value.trim()).filter(Boolean))
  : null;

export function moduleEnabled(id) {
  // Direct bridge tests and older launchers omit the variable and retain the
  // historical all-enabled behavior. The production launcher always supplies
  // the exact profile-resolved module list.
  return configured === null || configured.has(id);
}

export function enabledModuleIDs() {
  return configured === null ? null : [...configured].sort();
}
