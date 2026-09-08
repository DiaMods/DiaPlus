import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { profileDirectory } from "./paths.js";

// Settings select actual browser profile directories, never an arbitrary string
// or a connector account. Only the browser's display name leaves this module.
export async function discoverProfiles(directory = profileDirectory) {
  if (!directory) return { profiles: [], selectedProfileID: null };
  const userData = resolve(directory, "User Data");
  const [entries, localState] = await Promise.all([
    readdir(userData, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }),
    readFile(resolve(userData, "Local State"), "utf8").then((raw) => JSON.parse(raw)).catch((error) => {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
      throw error;
    }),
  ]);
  const metadata = localState?.profile?.info_cache ?? {};
  const profiles = entries.filter((entry) => entry.isDirectory() &&
    (entry.name === "Default" || /^Profile \d+$/.test(entry.name) ||
      (Object.hasOwn(metadata, entry.name) && /^[^/\\\0]{1,120}$/.test(entry.name))))
    .map((entry) => {
      const name = metadata[entry.name]?.name;
      return { id: entry.name, name: typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : entry.name };
    })
    .sort((left, right) => left.id === "Default" ? -1 : right.id === "Default" ? 1 : left.id.localeCompare(right.id, undefined, { numeric: true }));
  const lastUsed = localState?.profile?.last_used;
  return { profiles, selectedProfileID: profiles.some((profile) => profile.id === lastUsed) ? lastUsed : profiles[0]?.id ?? null };
}

export async function handleProfilesAPI(request, response, requestURL, { hasAdminToken, jsonResponse, discover = discoverProfiles }) {
  if (requestURL.pathname !== "/api/profiles") return false;
  if (!await hasAdminToken(request)) jsonResponse(response, 403, { error: "invalid local administration token" });
  else if (request.method !== "GET") jsonResponse(response, 405, { error: "method_not_allowed" });
  else {
    try { jsonResponse(response, 200, await discover()); }
    catch { jsonResponse(response, 500, { error: "Browser profiles could not be read" }); }
  }
  return true;
}
