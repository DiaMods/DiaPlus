import assert from "node:assert/strict";
import test from "node:test";
import { renderSettingsPage } from "../src/settings-page.js";

test("local settings page keeps provider, memory, connector, and tool controls parseable", () => {
  const html = renderSettingsPage("local-test-token");
  assert.match(html, /Add OpenAI-compatible provider/);
  assert.match(html, /Local connectors/);
  assert.match(html, /Local memory/);
  assert.match(html, /Tool coverage/);
  assert.match(html, /id="tool-coverage"/);
  assert.match(html, /id="advanced-json"/);
  assert.match(html, /local-test-token/);

  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
