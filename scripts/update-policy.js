export function classifyUpdate(report, { allowDisableIncompatible = false } = {}) {
  const requiredFailures = Array.isArray(report?.requiredFailures) ? report.requiredFailures : [];
  const optionalFailures = Array.isArray(report?.optionalFailures) ? report.optionalFailures : [];
  if (requiredFailures.length > 0) {
    return { action: "block", effectiveMods: [], failures: requiredFailures };
  }
  if (optionalFailures.length > 0 && !allowDisableIncompatible) {
    return {
      action: "confirm-disable-optional",
      effectiveMods: report.effectiveMods ?? [],
      failures: optionalFailures,
    };
  }
  return {
    action: optionalFailures.length > 0 ? "stage-partial" : "stage-full",
    effectiveMods: report.effectiveMods ?? report.requestedMods ?? [],
    failures: optionalFailures,
  };
}

export function resolveInteractiveUpdate(decision, accepted) {
  if (decision.action !== "confirm-disable-optional") return decision;
  return accepted
    ? { ...decision, action: "stage-partial" }
    : { ...decision, action: "keep-current", effectiveMods: [] };
}
