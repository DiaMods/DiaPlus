#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binary = process.argv[2];
if (!binary || process.argv.length !== 3) {
  throw new Error("usage: check-new-tab-state.js /path/to/Dia");
}
const directory = dirname(fileURLToPath(import.meta.url));
const rows = execFileSync(process.execPath, [
  resolve(directory, "../../research/tools/parse-swift-fields.js"),
  resolve(binary), "isPersonalizeButtonEnabled",
], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(JSON.parse);
const shared = [
  "windowID", "displayDefaultBrowserUpsell", "displayReleaseNotesPostcard",
  "displayWelcomePostcardTeaser", "displayTrialGuideStampCard", "displayAppsUpsellBar",
  "displayNewSingleAppUpsell", "themePalette", "skillOverridePalette",
  "profileCustomizationPermitted", "displayTryForAWeek", "greeting", "bookmarkBarMode",
  "konamiCodeOnboardingIntroTriggerEnabled", "diaProBackgroundButtonState",
  "lightConfiguration", "areAnimationsEnabled",
];
const layouts = [
  [...shared, "isPersonalizeButtonEnabled", "showParticlesLogo", "isPresentingCliaOnboardingView"],
  [...shared, "isRebrandEnabled", "isPersonalizeButtonEnabled", "showDiaIcon", "isPresentingCliaOnboardingView"],
  [
    "windowID", "displayDefaultBrowserUpsell", "displayReleaseNotesPostcard",
    "displayWelcomePostcardTeaser", "hidePostcardsOnlyWhenCommandBarIntersects",
    "displayTrialGuideStampCard", "displayAppsUpsellBar", "displayNewSingleAppUpsell",
    "themePalette", "skillOverridePalette", "profileCustomizationPermitted",
    "displayTryForAWeek", "greeting", "bookmarkBarMode",
    "konamiCodeOnboardingIntroTriggerEnabled", "lightConfiguration",
    "daylightEffectInputs", "areAnimationsEnabled", "isRebrandEnabled",
    "isPersonalizeButtonEnabled", "showDiaIcon", "isPresentingCliaOnboardingView",
  ],
];
if (rows.length !== 1 || !layouts.some((labels) =>
  rows[0].fields.length === labels.length && labels.every((label, index) =>
    rows[0].fields[index].name === label &&
    (index < (labels.length === 22 ? 17 : 16) || rows[0].fields[index].type === "Sb") &&
    (label !== "hidePostcardsOnlyWhenCommandBarIntersects" || rows[0].fields[index].type === "Sb") &&
    (label !== "daylightEffectInputs" || rows[0].fields[index].type !== "Sb")))) {
  throw new Error("native Advanced Chat state layout changed; expected one guarded 20/21/22-field state with Boolean appearance flags");
}
process.stdout.write(`${JSON.stringify({
  offset: rows[0].offset,
  fieldCount: rows[0].fields.length,
  logoField: rows[0].fields.at(-2).name,
})}\n`);
