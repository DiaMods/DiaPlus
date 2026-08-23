import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helper = resolve(projectDirectory, ".build/apple-model-helper/DiaCustomAppleModel");

async function invoke(value) {
  const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(JSON.stringify(value));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("close", done);
  });
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout.trim()).value;
}

test("Apple Foundation Models helper reports runtime availability", async (context) => {
  try { await access(helper); } catch { context.skip("Apple helper has not been built"); return; }
  const value = await invoke({ action: "status" });
  assert.equal(typeof value.onDevice.available, "boolean");
  assert.equal(typeof value.privateCloud.available, "boolean");
});
