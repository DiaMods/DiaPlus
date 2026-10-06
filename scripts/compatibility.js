#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(scriptDirectory);
const manifestPath = resolve(projectDirectory, "bridge/config/dia-mods.json");
const buildsPath = resolve(projectDirectory, "src/config/supported-dia-builds.json");

function parseArguments(values) {
  let app = null;
  let selected = null;
  let json = false;
  let requirePatched = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--mods" || value === "--modules") {
      selected = new Set((values[++index] ?? "").split(",").filter(Boolean));
    } else if (value === "--json") {
      json = true;
    } else if (value === "--require-patched") {
      requirePatched = true;
    } else if (!value.startsWith("--") && app === null) {
      app = resolve(value);
    } else {
      throw new Error(`unknown compatibility argument: ${value}`);
    }
  }
  if (!app) throw new Error("usage: ./dia-custom compatibility [/path/to/Dia.app] [--json]");
  return { app, selected, json, requirePatched };
}

function plist(app, field) {
  return execFileSync("/usr/libexec/PlistBuddy", [
    "-c", `Print :${field}`, resolve(app, "Contents/Info.plist"),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runNodeCheck(script, args) {
  try {
    execFileSync(process.execPath, [resolve(projectDirectory, script), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { compatible: true };
  } catch (error) {
    const lines = String(error?.stderr || error?.message || error)
      .trim().split("\n").map((line) => line.trim()).filter(Boolean);
    const detail = (lines.find((line) => /^Error:\s*/.test(line)) ?? lines.at(-1) ??
      "compatibility check failed").replace(/^Error:\s*/, "");
    return { compatible: false, reason: detail.slice(0, 500) };
  }
}

function containsEvery(buffer, values) {
  return values.every((value) => buffer.includes(Buffer.from(value)));
}

async function validate(name, app, context, mod) {
  const { executable, handler, schema } = context;
  switch (name) {
    case "app-bundle":
      try {
        await access(resolve(app, "Contents/MacOS/Dia"), constants.R_OK);
        await access(resolve(app, "Contents/Info.plist"), constants.R_OK);
        return { compatible: plist(app, "CFBundleIdentifier").length > 0 };
      } catch {
        return { compatible: false, reason: "Dia executable or Info.plist is unavailable" };
      }
    case "network-bootstrap":
      return executable.length > 10_000_000
        ? { compatible: true }
        : { compatible: false, reason: "unexpected Dia executable layout" };
    case "updater-plist":
    case "custom-updater":
      return context.hasSparkle
        ? { compatible: true }
        : { compatible: false, reason: "Dia's bundled updater surface was not found" };
    case "local-ai-routing": {
      const checkArgs = ["--check", ...(context.requirePatched ? ["--require-patched"] : []), app];
      const endpoints = runNodeCheck("src/patches/patch-endpoint.js", checkArgs);
      if (!endpoints.compatible) return endpoints;
      const agent = runNodeCheck("src/patches/patch-agent-handler.js", checkArgs);
      if (!agent.compatible) return agent;
      return runNodeCheck("src/patches/patch-no-account.js", [
        "--check", "--capabilities-only", app,
      ]);
    }
    case "anonymous-account":
      return runNodeCheck("src/patches/patch-no-account.js", [
        "--check", "--anonymous-only", app,
      ]);
    case "native-importer":
      return runNodeCheck("src/patches/patch-dia-import.js", ["--check", app]);
    case "native-reports": {
      const controller = runNodeCheck("src/patches/patch-report-controller.js", ["--check", app]);
      if (!controller.compatible) return controller;
      return runNodeCheck("src/patches/patch-report-upload.js", ["--check", app]);
    }
    case "model-picker":
      return containsEvery(executable, ["NewTabPage", "Chat"])
        ? { compatible: true }
        : { compatible: false, reason: "native chat/New Tab model surfaces changed" };
    case "developer-tools":
      if (!executable.includes(Buffer.from("toggleDevTools:")) &&
          !executable.includes(Buffer.from("Developer Tools"))) {
        return { compatible: false, reason: "native developer-tools action changed" };
      }
      return runNodeCheck("research/tools/discover-prompt-tools.js", [
        resolve(app, "Contents/MacOS/Dia"), context.build,
      ]);
    case "mod-manager":
      return executable.includes(Buffer.from("Preferences"))
        ? { compatible: true }
        : { compatible: false, reason: "native Settings host changed" };
    case "native-memory":
      return executable.includes(Buffer.from("MemoryPreferencePane"))
        ? { compatible: true }
        : { compatible: false, reason: "native Memory pane layout changed" };
    case "native-apps":
      return containsEvery(executable, ["AppsPreferencePaneView", "onEnableMorningBriefTapped"])
        ? runNodeCheck("src/bootstrap/check-new-tab-state.js", [resolve(app, "Contents/MacOS/Dia")])
        : { compatible: false, reason: "native Apps pane state or callbacks changed" };
    case "live-connectors": {
      let tools = [];
      try {
        tools = JSON.parse(schema.toString("utf8")).tools ?? [];
      } catch {
        return { compatible: false, reason: "native tool schema is not valid JSON" };
      }
      const capabilities = new Set(tools.flatMap((tool) =>
        tool?._meta?.["dia/requiredCapabilities"] ?? []));
      const hasTabs = tools.some((tool) => tool?.name === "read_tabs" &&
        tool?._meta?.["dia/requiredCapabilities"]?.includes("tabs"));
      const hasSessionConnector = [
        "gmail", "gcalendar", "gdrive", "github", "slack", "notionAutomatic", "linkedin",
      ].some((capability) => capabilities.has(capability));
      return hasTabs && hasSessionConnector
        ? { compatible: true }
        : { compatible: false, reason: "native connector/tab schemas changed" };
    }
    case "morning-brief": {
      if (!containsEvery(executable, [
        "MorningBriefScheduleClient", "openOrGenerateCliaReport", "AppsPreferencePaneView",
      ])) return { compatible: false, reason: "native Morning Brief scheduler/controller changed" };
      return runNodeCheck("src/bootstrap/discover-native-actions.js", [
        resolve(app, "Contents/MacOS/Dia"), plist(app, "CFBundleVersion"),
      ]);
    }
    case "bridge-owned":
    case "apple-helper":
      return { compatible: true };
    case "native-feature-experiment":
      return { compatible: false, reason: mod.availabilityReason ?? "Native feature audit is pending" };
    default:
      return { compatible: false, reason: `unknown compatibility validator ${name}` };
  }
}

const { app, selected, json, requirePatched } = parseArguments(process.argv.slice(2));
const [manifest, builds, executable, handler, schema] = await Promise.all([
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(buildsPath, "utf8").then(JSON.parse),
  readFile(resolve(app, "Contents/MacOS/Dia")),
  readFile(resolve(app, "Contents/Resources/agent-server-resources/dist/handler")),
  readFile(resolve(app, "Contents/Resources/agent-server-resources/dist/resources/tool-schemas/dia.json")),
]);
const build = plist(app, "CFBundleVersion");
const version = plist(app, "CFBundleShortVersionString");
const record = builds.builds?.[build];
const requested = selected ?? new Set(manifest.mods
  .filter((mod) => mod.required || mod.defaultEnabled !== false)
  .map((mod) => mod.id));
const known = new Set(manifest.mods.map((mod) => mod.id));
const unknown = [...requested].filter((id) => !known.has(id));
if (unknown.length > 0) throw new Error(`unknown Dia Mods: ${unknown.join(", ")}`);
const context = {
  build,
  executable,
  handler,
  schema,
  requirePatched,
  hasSparkle: await access(resolve(app, "Contents/Frameworks/Sparkle.framework"), constants.R_OK)
    .then(() => true).catch(() => false),
};
const perMod = [];
for (const mod of manifest.mods.filter((candidate) => requested.has(candidate.id))) {
  const audited = record?.status === "audited" &&
    new Set(record.mods ?? record.modules ?? []).has(mod.id);
  // A build number is metadata, not proof that this candidate still contains
  // the audited code. Always validate the actual downloaded/staged content.
  const outcome = {
    ...(await validate(mod.compatibilityValidator, app, context, mod)),
    source: audited ? "audited-build-and-structural-validator" : "structural-validator",
  };
  perMod.push({
    id: mod.id,
    label: mod.label,
    criticality: mod.criticality ?? (mod.required ? "critical" : "optional"),
    required: mod.required === true,
    ...outcome,
  });
}
const requiredFailures = perMod.filter((mod) => mod.required && !mod.compatible);
const optionalFailures = perMod.filter((mod) => !mod.required && !mod.compatible);
const result = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  app,
  build,
  version,
  buildStatus: record?.status ?? "unknown",
  compatible: requiredFailures.length === 0 && optionalFailures.length === 0,
  canContinueWithoutOptional: requiredFailures.length === 0,
  requestedMods: [...requested],
  effectiveMods: perMod.filter((mod) => mod.compatible).map((mod) => mod.id),
  unavailableMods: optionalFailures.map((mod) => mod.id),
  requiredFailures,
  optionalFailures,
  perMod,
};
if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`Dia ${version} (${build}) compatibility\n\n`);
  for (const mod of perMod) {
    process.stdout.write(`${mod.compatible ? "ok  " : "FAIL"}  ${mod.id}${mod.reason ? ` — ${mod.reason}` : ""}\n`);
  }
  process.stdout.write(requiredFailures.length > 0
    ? `\n${requiredFailures.length} critical Dia Mod(s) are incompatible; update is blocked.\n`
    : optionalFailures.length > 0
      ? `\n${optionalFailures.length} optional Dia Mod(s) can be temporarily disabled.\n`
      : "\nAll requested Dia Mods are compatible.\n");
}
