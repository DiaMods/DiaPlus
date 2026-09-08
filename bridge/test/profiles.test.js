import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { discoverProfiles, handleProfilesAPI } from "../src/profiles.js";

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-profiles-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const userData = resolve(directory, "User Data");
  await mkdir(userData);
  return { directory, userData };
}

test("profile discovery lists real directories and display names with stable IDs, selecting last used", async (t) => {
  const { directory, userData } = await fixture(t);
  await Promise.all(["Default", "Profile 2", "Profile 10", "Shared Space", "Cache", "Guest Profile"].map((name) => mkdir(resolve(userData, name))));
  await writeFile(resolve(userData, "Profile 3"), "not a directory");
  await symlink(resolve(userData, "Default"), resolve(userData, "Profile 4"));
  await writeFile(resolve(userData, "Local State"), JSON.stringify({ profile: {
    last_used: "Profile 2", info_cache: {
      Default: { name: "Personal", user_name: "private@example.com", gaia_id: "secret" },
      "Profile 2": { name: "Work" }, "Shared Space": { name: "Shared" },
      "Profile 99": { name: "Deleted profile" },
    },
  } }));
  const result = await discoverProfiles(directory);
  assert.deepEqual(result, {
    profiles: [{ id: "Default", name: "Personal" }, { id: "Profile 2", name: "Work" }, { id: "Profile 10", name: "Profile 10" }, { id: "Shared Space", name: "Shared" }],
    selectedProfileID: "Profile 2",
  });
  assert.doesNotMatch(JSON.stringify(result), /private@example|secret|User Data|Cache|Deleted/);
});

test("missing or malformed Local State falls back to real profile folders without fabricating Default", async (t) => {
  const { directory, userData } = await fixture(t);
  assert.deepEqual(await discoverProfiles(directory), { profiles: [], selectedProfileID: null });
  assert.deepEqual(await discoverProfiles(null), { profiles: [], selectedProfileID: null });
  await mkdir(resolve(userData, "Profile 7"));
  await writeFile(resolve(userData, "Local State"), "{ incomplete");
  assert.deepEqual(await discoverProfiles(directory), { profiles: [{ id: "Profile 7", name: "Profile 7" }], selectedProfileID: "Profile 7" });
  await writeFile(resolve(userData, "Local State"), JSON.stringify({ profile: { last_used: "Gone", info_cache: { "Profile 7": { name: "  " } } } }));
  assert.equal((await discoverProfiles(directory)).selectedProfileID, "Profile 7");
});

test("profile endpoint requires local admin authentication and returns no raw filesystem errors", async () => {
  const replies = [];
  let discoveries = 0;
  const dependencies = { hasAdminToken: async (request) => request.authorized,
    jsonResponse: (_response, status, value) => replies.push({ status, value }),
    discover: async () => { discoveries += 1; return { profiles: [], selectedProfileID: null }; } };
  const url = new URL("http://127.0.0.1/api/profiles");
  assert.equal(await handleProfilesAPI({ method: "GET", authorized: false }, {}, url, dependencies), true);
  assert.equal(replies.at(-1).status, 403);
  assert.equal(discoveries, 0);
  await handleProfilesAPI({ method: "POST", authorized: true }, {}, url, dependencies);
  assert.equal(replies.at(-1).status, 405);
  await handleProfilesAPI({ method: "GET", authorized: true }, {}, url, dependencies);
  assert.equal(replies.at(-1).status, 200);
  assert.equal(discoveries, 1);
  await handleProfilesAPI({ method: "GET", authorized: true }, {}, url, { ...dependencies, discover: async () => { throw new Error("/private/person/profile"); } });
  assert.deepEqual(replies.at(-1), { status: 500, value: { error: "Browser profiles could not be read" } });
});
