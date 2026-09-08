import assert from "node:assert/strict";
import test from "node:test";
import { initializeConnectorSettings, initializeProfileSettings, initializeSettingsNavigation, renderModsPage, renderSettingsPage } from "../src/settings-page.js";

test("local settings page keeps provider, memory, connector, and tool controls parseable", () => {
  const html = renderSettingsPage("local-test-token");
  assert.match(html, /Add OpenAI-compatible provider/);
  assert.match(html, /Imported records/);
  assert.match(html, /Live connectors/);
  assert.match(html, /Spark Mail/);
  assert.match(html, /Local memory/);
  assert.match(html, /Tool coverage/);
  assert.match(html, /Dia Mods/);
  assert.match(html, /id="dia-mods"/);
  assert.match(html, /id="tool-coverage"/);
  assert.match(html, /id="advanced-json"/);
  assert.match(html, /local-test-token/);
  assert.match(html, /<title>Dia Mod Settings<\/title>/);
  assert.doesNotMatch(html, /Add an MCP server or connect Spark Mail/);
  assert.match(html, /<option value="spark-cli">Spark Mail/);
  for (const id of ['liveProfile', 'connectorProfile', 'workflowProfile']) {
    assert.match(html, new RegExp('<select id="' + id + '"'));
    assert.doesNotMatch(html, new RegExp('<input id="' + id + '"'));
  }

  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.text = "";
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((item) => item.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ""; this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(event, listener) { this.listeners.set(event, [...(this.listeners.get(event) || []), listener]); }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); }
  async fire(type, extra = {}) { for (const listener of this.listeners.get(type) || []) await listener({ type, preventDefault() {}, ...extra }); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  reportValidity() { return true; }
  all() { return [this, ...this.children.flatMap((item) => item.all())]; }
}

function connectorHarness({ connectors = [], error = null, liveConnectorsEnabled = true } = {}) {
  const html = renderSettingsPage("test-token");
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  const field = (id) => elements.get(id);
  const reset = () => {
    for (const id of ["liveID", "liveName", "liveEndpoint", "liveHosts", "liveAuthorizationURL", "liveTokenURL", "liveClientID", "liveScopes", "liveRevocationURL"]) field(id).value = "";
    field("liveType").value = "mcp";
    field("liveAuthentication").value = "none";
    field("liveCommand").value = "/usr/local/bin/spark";
  };
  reset();
  field("liveProfile").value = "Default";
  field("liveConnectorForm").reset = reset;
  const document = { querySelector: (selector) => field(selector.slice(1)), createElement: (tag) => new Element(tag) };
  const requests = [];
  const state = { connectors: structuredClone(connectors), error, liveConnectorsEnabled, confirm: true };
  const request = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method: options.method || "GET", body });
    if (state.error) throw new Error(state.error);
    if (path.startsWith("/api/apps/state?")) {
      const result = { connectors: structuredClone(state.connectors), liveConnectorsEnabled: state.liveConnectorsEnabled };
      if (state.waitForState) await state.waitForState(path);
      return result;
    }
    if (path === "/api/apps/connectors") {
      state.connectors = state.connectors.filter((item) => item.id !== body.manifest.id);
      state.connectors.push({ ...body.manifest, connected: false, authenticated: false, executionReady: false });
      return { ok: true, connector: body.manifest };
    }
    const match = path.match(/\/connectors\/([^/]+)(?:\/(.*))?$/);
    const connector = state.connectors.find((item) => item.id === match?.[1]);
    if (match?.[2] === "tools") return { tools: [{ name: "read_mail", description: '<img src=x onerror="bad()">' }] };
    if (["connect", "reconnect"].includes(match?.[2])) {
      if (connector.authentication === "oauth") return { kind: "oauth", authorizationURL: "https://auth.example.com/authorize?state=test" };
      Object.assign(connector, { connected: true, authenticated: true, executionReady: true, toolCount: 1 });
      return { kind: "connected" };
    }
    if (match?.[2] === "disconnect") Object.assign(connector, { connected: false, authenticated: false, executionReady: false });
    if (options.method === "DELETE") state.connectors = state.connectors.filter((item) => item.id !== match?.[1]);
    return { ok: true };
  };
  const controller = initializeConnectorSettings({ document, request, confirm: () => state.confirm });
  const button = (label) => field("liveList").all().find((item) => item.tagName === "button" && item.textContent === label);
  return { ...controller, field, requests, state, button };
}

test("Spark preset saves without connecting, then connects, tests, disconnects and removes", async () => {
  const ui = connectorHarness();
  await ui.ready;
  assert.match(ui.field("liveList").textContent, /No live connectors/);
  ui.field("liveProfile").value = "Profile 1";
  await ui.field("liveProfile").fire("change");
  ui.field("liveType").value = "spark-cli";
  await ui.field("liveType").fire("change");
  assert.equal(ui.field("sparkFields").hidden, false);
  assert.equal(ui.field("mcpFields").disabled, true);
  ui.field("liveCommand").value = "/opt/homebrew/bin/spark";
  await ui.field("liveConnectorForm").fire("submit");
  const saved = ui.requests.find((item) => item.method === "POST");
  assert.deepEqual(saved.body, { profileID: "Profile 1", manifest: {
    id: "spark", displayName: "Spark Mail", execution: "bridge", transport: "spark-cli",
    authentication: "none", command: "/opt/homebrew/bin/spark",
  } });
  assert.equal(ui.requests.some((item) => item.path.endsWith("/connect")), false);
  assert.equal(ui.button("Test tools").disabled, true);
  await ui.button("Connect").fire("click");
  assert.match(ui.field("liveList").textContent, /Connected/);
  assert.deepEqual(ui.requests.find((item) => item.path.endsWith("/connect")).body, { profileID: "Profile 1" });
  await ui.button("Test tools").fire("click");
  assert.match(ui.field("liveList").textContent, /1 tool discovered/);
  assert.ok(ui.field("liveList").textContent.includes('<img src=x onerror="bad()">'));
  assert.equal(ui.field("liveList").all().some((item) => item.tagName === "img"), false);
  await ui.button("Disconnect").fire("click");
  assert.match(ui.field("liveList").textContent, /Disconnected/);
  ui.state.confirm = false;
  await ui.button("Remove").fire("click");
  assert.equal(ui.state.connectors.length, 1);
  ui.state.confirm = true;
  await ui.button("Remove").fire("click");
  assert.equal(ui.state.connectors.length, 0);
});

test("bearer credentials are supplied only when explicitly connecting and then cleared", async () => {
  const ui = connectorHarness();
  await ui.ready;
  ui.field("liveID").value = "sample";
  ui.field("liveName").value = "My MCP";
  ui.field("liveEndpoint").value = "https://mcp.example.com/mcp";
  await ui.field("liveEndpoint").fire("input");
  assert.equal(ui.field("liveHosts").value, "mcp.example.com");
  ui.field("liveAuthentication").value = "bearer";
  await ui.field("liveAuthentication").fire("change");
  assert.equal(ui.field("liveBearerHelp").hidden, false);
  await ui.field("liveConnectorForm").fire("submit");
  const secret = ui.field("liveList").all().find((item) => item.type === "password");
  await ui.button("Connect").fire("click");
  assert.match(ui.field("liveList").textContent, /Enter a bearer token/);
  assert.equal(ui.requests.some((item) => item.path.endsWith("/connect")), false);
  secret.value = "private-token";
  await ui.button("Connect").fire("click");
  const saved = ui.requests.find((item) => item.path === "/api/apps/connectors");
  assert.deepEqual(saved.body.manifest.allowedDomains, ["mcp.example.com"]);
  assert.equal(JSON.stringify(saved).includes("private-token"), false);
  assert.equal(secret.value, "");
  assert.deepEqual(ui.requests.find((item) => item.path.endsWith("/connect")).body, { profileID: "Default", token: "private-token" });
});

test("OAuth setup preserves all hosts and scopes and presents the explicit authorization link", async () => {
  const ui = connectorHarness();
  await ui.ready;
  for (const [id, value] of Object.entries({ liveID: "sample", liveName: "Sample", liveEndpoint: "https://mcp.example.com/mcp",
    liveHosts: "mcp.example.com, auth.example.com", liveAuthentication: "oauth", liveAuthorizationURL: "https://auth.example.com/authorize",
    liveTokenURL: "https://auth.example.com/token", liveClientID: "custom-client", liveScopes: "read, search", liveRevocationURL: "https://auth.example.com/revoke",
  })) ui.field(id).value = value;
  await ui.field("liveAuthentication").fire("change");
  assert.equal(ui.field("oauthFields").hidden, false);
  await ui.field("liveConnectorForm").fire("submit");
  const saved = ui.requests.find((item) => item.path === "/api/apps/connectors");
  assert.deepEqual(saved.body.manifest.allowedDomains, ["mcp.example.com", "auth.example.com"]);
  assert.deepEqual(saved.body.manifest.oauth.scopes, ["read", "search"]);
  await ui.button("Connect").fire("click");
  const link = ui.field("liveAuthLink").children[0];
  assert.equal(link.href, "https://auth.example.com/authorize?state=test");
  assert.equal(link.rel, "noopener noreferrer");
  assert.match(ui.field("liveStatus").textContent, /Finish sign-in/);
  await ui.button("Edit").fire("click");
  assert.equal(ui.field("liveID").disabled, true);
  assert.equal(ui.field("liveClientID").value, "custom-client");
  assert.match(ui.field("liveFormStatus").textContent, /every profile/);
});

test("connection errors are visible, controls recover, and disabled mods cannot save", async () => {
  const ui = connectorHarness({ connectors: [{ id: "spark", displayName: "Spark", execution: "bridge", transport: "spark-cli", authentication: "none", command: "/missing/spark", connected: false }] });
  await ui.ready;
  ui.state.error = "Spark CLI was not found";
  const connect = ui.button("Connect");
  await connect.fire("click");
  assert.equal(connect.disabled, false);
  assert.match(ui.field("liveList").textContent, /Spark CLI was not found/);
  await ui.refresh();
  assert.equal(ui.field("liveNotice").className, "error");
  ui.state.error = null;
  ui.state.liveConnectorsEnabled = false;
  await ui.refresh();
  assert.equal(ui.field("liveFields").disabled, true);
  assert.match(ui.field("liveNotice").textContent, /Enable the Live connectors mod/);
  const count = ui.requests.length;
  await ui.field("liveConnectorForm").fire("submit");
  assert.equal(ui.requests.length, count);
});

test("invalid profile names are reported without requesting a different profile", async () => {
  const ui = connectorHarness();
  await ui.ready;
  ui.field("liveProfile").value = "../../Private";
  await ui.field("liveProfile").fire("change");
  assert.equal(ui.field("liveNotice").className, "error");
  assert.equal(ui.requests.length, 1);
});

test("late profile responses cannot replace the current profile's connection list", async () => {
  const ui = connectorHarness({ connectors: [{ id: "personal", displayName: "Personal connector", execution: "bridge" }] });
  await ui.ready;
  let release;
  ui.state.waitForState = (path) => path.endsWith("Default") ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  const previous = ui.refresh();
  ui.state.connectors = [{ id: "work", displayName: "Work connector", execution: "bridge" }];
  ui.field("liveProfile").value = "Work";
  await ui.field("liveProfile").fire("change");
  assert.match(ui.field("liveList").textContent, /Work connector/);
  release();
  await previous;
  assert.match(ui.field("liveList").textContent, /Work connector/);
  assert.doesNotMatch(ui.field("liveList").textContent, /Personal connector/);
  assert.equal(ui.field("liveNotice").textContent, "Connections for Work");
});

test("endpoint host inference follows URL changes until hosts are explicitly edited", async () => {
  const ui = connectorHarness();
  await ui.ready;
  for (const [host, event] of [["first.example.com", "input"], ["second.example.com", "change"]]) {
    ui.field("liveEndpoint").value = "https://" + host + "/mcp";
    await ui.field("liveEndpoint").fire(event);
    assert.equal(ui.field("liveHosts").value, host);
  }
  ui.field("liveHosts").value = "custom.example.com, auth.example.com";
  await ui.field("liveHosts").fire("input");
  ui.field("liveEndpoint").value = "https://third.example.com/mcp";
  await ui.field("liveEndpoint").fire("change");
  assert.equal(ui.field("liveHosts").value, "custom.example.com, auth.example.com");
});

test("save infers an autofilled URL host before the browser validates required fields", async () => {
  const ui = connectorHarness();
  await ui.ready;
  ui.field("liveEndpoint").value = "https://autofilled.example.com/mcp";
  assert.equal(ui.field("liveHosts").value, "");
  await ui.field("saveLive").fire("click");
  assert.equal(ui.field("liveHosts").value, "autofilled.example.com");
});

test("adding an existing ID asks the user to edit instead of silently disconnecting accounts", async () => {
  const ui = connectorHarness({ connectors: [{ id: "spark", displayName: "Spark", execution: "bridge", transport: "spark-cli" }] });
  await ui.ready;
  ui.field("liveType").value = "spark-cli";
  await ui.field("liveType").fire("change");
  await ui.field("liveConnectorForm").fire("submit");
  assert.equal(ui.requests.some((item) => item.method === "POST"), false);
  assert.match(ui.field("liveFormStatus").textContent, /already exists/);
});

test("native Mods pane payload contains only the authenticated local manager", () => {
  const html = renderModsPage("mods-test-token");
  assert.match(html, /Dia Mods/);
  assert.match(html, /\/api\/mods/);
  assert.match(html, /mods-test-token/);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

function windowHarness(hash = '', saved = {}) {
  const window = new Element();
  window.location = { hash };
  window.scrollTo = () => {};
  window.localStorage = { getItem: key => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } };
  window.history = { pushState: (_, __, next) => { window.location.hash = next; } };
  window.Event = class { constructor(type) { this.type = type; } };
  return window;
}

test('settings tabs preserve old deep links, support keyboard navigation and browser history', async () => {
  const ids = ['models', 'mods', 'connections', 'knowledge', 'memory', 'updates', 'advanced'];
  const tabs = ids.map(id => Object.assign(new Element('button'), { dataset: { settingsTab: id } }));
  const panels = ids.map(id => Object.assign(new Element('section'), { id: 'panel-' + id }));
  const updater = new Element();
  const document = { querySelectorAll: selector => selector.includes('data-settings-tab') ? tabs : panels, getElementById: id => id === 'custom-updater' ? updater : null };
  const window = windowHarness('#custom-updater', { 'dia-mod-settings-tab': 'models' });
  const ui = initializeSettingsNavigation({ document, window });
  assert.equal(ui.active, 'updates');
  assert.equal(updater.scrolled, true);
  assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.id), ['panel-updates']);
  await tabs[5].fire('keydown', { key: 'ArrowRight' });
  assert.equal(ui.active, 'advanced');
  assert.equal(tabs[6].focused, true);
  assert.equal(window.location.hash, '#advanced');
  await tabs[6].fire('keydown', { key: 'Home' });
  assert.equal(ui.active, 'models');
  window.location.hash = '#connections';
  await window.fire('popstate');
  assert.equal(ui.active, 'connections');
  assert.equal(tabs[2].attributes.get('aria-selected'), 'true');
  assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
  window.location.hash = '';
  await window.fire('hashchange');
  assert.equal(ui.active, 'connections');
});

test('real profile dropdowns restore a valid choice and synchronize sections without duplicate change events', async () => {
  const selects = [new Element('select'), new Element('select'), new Element('select')];
  const notice = new Element();
  const document = { querySelectorAll: () => selects, querySelector: () => notice, createElement: tag => new Element(tag) };
  const window = windowHarness('', { 'dia-mod-settings-profile': 'Deleted Profile' });
  const ui = initializeProfileSettings({ document, window, request: async path => {
    assert.equal(path, '/api/profiles');
    return { profiles: [{ id: 'Default', name: 'Personal' }, { id: 'Profile 1', name: 'Work <img src=x>' }], selectedProfileID: 'Profile 1' };
  } });
  assert.equal(await ui.ready, 'Profile 1');
  assert.ok(selects.every(select => select.value === 'Profile 1' && !select.disabled));
  assert.deepEqual(selects[0].children.map(option => [option.value, option.textContent]), [['Default', 'Personal'], ['Profile 1', 'Work <img src=x>']]);
  const changes = [0, 0, 0];
  selects.forEach((select, index) => select.addEventListener('change', () => { changes[index]++; }));
  selects[0].value = 'Default';
  await selects[0].fire('change');
  assert.deepEqual(changes, [1, 1, 1]);
  assert.ok(selects.every(select => select.value === 'Default'));
  assert.equal(window.localStorage.getItem('dia-mod-settings-profile'), 'Default');
  const next = initializeProfileSettings({ document, window, request: async () => ({ profiles: [{ id: 'Default', name: 'Personal' }, { id: 'Profile 1', name: 'Work' }], selectedProfileID: 'Profile 1' }) });
  assert.equal(await next.ready, 'Default');
});

test('profile discovery failure leaves profile controls unavailable instead of inventing a profile', async () => {
  const select = new Element('select');
  const notice = new Element();
  const importButton = new Element('button');
  const document = { querySelectorAll: () => [select], querySelector: selector => selector === '#profileStatus' ? notice : importButton };
  const ui = initializeProfileSettings({ document, window: windowHarness(), request: async () => ({ profiles: [] }) });
  await assert.rejects(ui.ready, /No Dia profiles/);
  assert.equal(select.disabled, true);
  assert.equal(select.children.length, 0);
  assert.equal(importButton.disabled, true);
  assert.equal(notice.className, 'error');
});

test('saved reconnect intent remains visible and can be disconnected while the server is unavailable', async () => {
  const ui = connectorHarness({ connectors: [{ id: 'sample', displayName: 'Offline MCP', execution: 'bridge', authentication: 'none', connected: false, desiredConnected: true, connectionState: 'error', lastError: 'Server unavailable' }] });
  await ui.ready;
  assert.match(ui.field('liveList').textContent, /Needs attention/);
  assert.match(ui.field('liveList').textContent, /connection preference is saved/);
  assert.equal(ui.button('Disconnect').disabled, false);
  await ui.button('Disconnect').fire('click');
  assert.ok(ui.requests.some(request => request.path.endsWith('/disconnect')));
});
