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

test("Apple on-device helper accepts Dia's structured tool mode", async (context) => {
  try { await access(helper); } catch { context.skip("Apple helper has not been built"); return; }
  const status = await invoke({ action: "status" });
  if (!status.onDevice.available) {
    context.skip(status.onDevice.reason ?? "Apple on-device model is unavailable");
    return;
  }

  const value = await invoke({
    action: "generate",
    mode: "on-device",
    prompt: "Return a brief final answer explaining that this is a bridge self-test.",
    structured: true,
    toolsJSON: JSON.stringify([
      {
        name: "read_tabs",
        description: "Read open browser tabs",
        input_schema: {
          type: "object",
          properties: { tab_ids: { type: "array", items: { type: "string" } } },
          required: ["tab_ids"],
        },
      },
      {
        name: "open_tabs",
        description: "Open browser tabs",
        input_schema: {
          type: "object",
          properties: { urls: { type: "array", items: { type: "string" } } },
          required: ["urls"],
        },
      },
    ]),
    maximumResponseTokens: 96,
  });
  assert.ok(["final", "tool_use"].includes(value.kind));
  assert.equal(typeof value.text, "string");
  assert.ok(Array.isArray(value.tool_calls));
  assert.equal(typeof value.usage?.total_tokens, "number");
});
