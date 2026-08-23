import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { ConfigStore, defaultConfig } from "../src/config.js";
import { assertAllowedProviderURL, isDiaHost } from "../src/network-policy.js";

test("provider network policy blocks Dia while allowing public and loopback providers", () => {
  assert.equal(isDiaHost("api.diabrowser.engineering"), true);
  assert.equal(isDiaHost("thebrowser.company"), true);
  assert.throws(() => assertAllowedProviderURL("https://api.diabrowser.engineering/v1"));
  assert.throws(() => assertAllowedProviderURL("https://sub.thebrowser.company/models"));
  assert.equal(assertAllowedProviderURL("http://127.0.0.1:11434/v1").hostname, "127.0.0.1");
  assert.equal(assertAllowedProviderURL("https://api.openai.com/v1").hostname, "api.openai.com");
});

test("configuration persists selection without exposing its administration token", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-config-"));
  const path = resolve(directory, "config.json");
  const store = new ConfigStore(path);
  const initial = await store.load();
  assert.equal(initial.selectedModel, "codex:gpt-5.6-luna");
  assert.ok(initial.adminToken.length >= 24);
  assert.equal(store.publicValue().adminToken, undefined);

  await store.select("codex:gpt-5.6-terra");
  const persisted = JSON.parse(await readFile(path, "utf8"));
  assert.equal(persisted.selectedModel, "codex:gpt-5.6-terra");
  assert.equal(persisted.adminToken, initial.adminToken);
});

test("configuration rejects provider endpoints owned by Dia", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-bad-config-"));
  const value = defaultConfig();
  value.providers.push({
    id: "bad",
    type: "openai-compatible",
    api: "responses",
    label: "Bad",
    enabled: true,
    baseURL: "https://api.diabrowser.engineering/v1",
    models: [{ id: "x", label: "x" }],
  });
  const store = new ConfigStore(resolve(directory, "config.json"));
  await assert.rejects(store.update(value), /Dia Custom refuses provider traffic/);
});
