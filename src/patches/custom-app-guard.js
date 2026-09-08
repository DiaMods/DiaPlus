import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";

const CUSTOM_BUNDLE_ID = "local.rttm.dia";

export function isCustomAppName(name) {
  return name.endsWith(".app") && (name.startsWith("Dia Custom") || name.startsWith("Dia+."));
}

export function assertPatchableCustomApp(appPath) {
  const app = appPath ? resolve(appPath) : "";
  if (!app || !isCustomAppName(basename(app))) {
    throw new Error(`refusing to patch a non-clone app: ${app}`);
  }

  let bundleID = "";
  try {
    bundleID = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleIdentifier", `${app}/Contents/Info.plist`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    // A missing or unreadable bundle identity is never safe to modify.
  }
  if (bundleID !== CUSTOM_BUNDLE_ID) {
    throw new Error(`refusing to patch a non-clone app: ${app}`);
  }
  return app;
}
