import assert from "node:assert/strict";
import test from "node:test";
import { classifyUpdate, resolveInteractiveUpdate } from "../../scripts/update-policy.js";

test("update policy distinguishes full, partial, cancelled, and critically blocked builds", () => {
  const compatible = { requestedMods: ["core", "extra"], effectiveMods: ["core", "extra"], requiredFailures: [], optionalFailures: [] };
  assert.equal(classifyUpdate(compatible).action, "stage-full");

  const optional = {
    ...compatible,
    effectiveMods: ["core"],
    optionalFailures: [{ id: "extra", reason: "native layout changed" }],
  };
  const confirmation = classifyUpdate(optional);
  assert.equal(confirmation.action, "confirm-disable-optional");
  assert.equal(resolveInteractiveUpdate(confirmation, false).action, "keep-current");
  assert.equal(resolveInteractiveUpdate(confirmation, true).action, "stage-partial");
  assert.equal(classifyUpdate(optional, { allowDisableIncompatible: true }).action, "stage-partial");

  const critical = {
    ...compatible,
    effectiveMods: ["extra"],
    requiredFailures: [{ id: "core", reason: "routing changed" }],
  };
  assert.equal(classifyUpdate(critical).action, "block");
});
