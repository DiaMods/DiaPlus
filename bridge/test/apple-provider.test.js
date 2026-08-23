import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helper = resolve(projectDirectory, ".build/apple-model-helper/DiaCustomAppleModel");

test("Apple provider preserves a helper's structured error", async (context) => {
  try { await access(helper); } catch { context.skip("Apple helper has not been built"); return; }
  process.env.DIA_CUSTOM_APPLE_MODEL_HELPER = helper;
  const { runAppleProvider } = await import("../src/providers/apple.js");
  await assert.rejects(
    runAppleProvider({
      provider: { mode: "unsupported-test-mode" },
      model: "default",
      payload: { messages: [{ role: "user", content: "test" }] },
      tools: [],
    }),
    /Unsupported Apple model mode/,
  );
});

test("Apple provider completes Dia's structured decision bridge", async (context) => {
  try { await access(helper); } catch { context.skip("Apple helper has not been built"); return; }
  process.env.DIA_CUSTOM_APPLE_MODEL_HELPER = helper;
  const { appleProviderStatus, runAppleProvider } = await import("../src/providers/apple.js");
  const status = await appleProviderStatus();
  if (!status.onDevice.available) {
    context.skip(status.onDevice.reason ?? "Apple on-device model is unavailable");
    return;
  }

  const reasoning = [];
  const result = await runAppleProvider({
    provider: { mode: "on-device" },
    model: "default",
    payload: {
      max_tokens: 128,
      system: "Answer the current browser chat request.",
      messages: [{ role: "user", content: "Briefly say that the provider bridge self-test passed." }],
    },
    tools: [{
      name: "read_tabs",
      description: "Read selected browser tabs",
      input_schema: {
        type: "object",
        properties: { tab_ids: { type: "array", items: { type: "string" } } },
        required: ["tab_ids"],
      },
    }],
    onReasoning: async (message) => reasoning.push(message),
  });

  assert.ok(["final", "tool_use"].includes(result.kind));
  assert.equal(result.model, "default");
  assert.ok(Array.isArray(result.toolCalls));
  assert.equal(typeof result.usage?.total_tokens, "number");
  assert.deepEqual(reasoning, ["Using Apple Intelligence on this Mac..."]);
});
