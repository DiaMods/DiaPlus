import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { AppsStateStore } from "../src/apps-state.js";
import { ConnectorRegistry } from "../src/connectors/registry.js";
import { CredentialStore } from "../src/credentials.js";

async function fixture(fetchImplementation, { authentication = "none" } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-connectors-"));
  const manifests = resolve(directory, "connectors");
  await mkdir(manifests);
  await writeFile(resolve(manifests, "sample.json"), JSON.stringify({
    id: "sample",
    displayName: "Sample MCP",
    endpoint: "http://127.0.0.1:9876/mcp",
    allowedDomains: ["127.0.0.1"],
    authentication,
    ...(authentication === "oauth" ? { oauth: {
      authorizationURL: "http://127.0.0.1:9876/authorize",
      tokenURL: "http://127.0.0.1:9876/token",
      revocationURL: "http://127.0.0.1:9876/revoke",
      clientID: "dia-custom-test",
      scopes: ["read"],
    } } : {}),
  }));
  const stateStore = new AppsStateStore(resolve(directory, "apps.json"));
  const credentialStore = new CredentialStore(resolve(directory, "credentials.json"));
  const registry = new ConnectorRegistry({
    stateStore,
    credentialStore,
    manifestDirectory: manifests,
    fetchImplementation,
    callbackBaseURL: "http://127.0.0.1:8765/api/apps/oauth/callback",
  });
  await stateStore.load();
  await registry.initialize();
  return { registry, credentialStore };
}

test("custom MCP discovery and calls are namespaced", async () => {
  const requests = [];
  const { registry } = await fixture(async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result:
      request.method === "tools/list"
        ? { tools: [{ name: "lookup", description: "Look up a record", inputSchema: { type: "object" } }] }
        : { content: [{ type: "text", text: "done" }] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const definitions = await registry.discoverTools("sample");
  assert.equal(definitions[0].name, "mcp__custom_sample__lookup");
  const result = await registry.execute(definitions[0].name, { id: 1 });
  assert.equal(result.content[0].text, "done");
  assert.deepEqual(requests.map((request) => request.method), ["tools/list", "tools/call"]);
});

test("advertised native schemas do not imply a signed-in session", async () => {
  const { registry } = await fixture(async () =>
    new Response(JSON.stringify({ result: { tools: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  await registry.observeNativeTools("Default", [{ name: "search_github" }]);
  const github = (await registry.status("Default")).find((row) => row.id === "github");
  assert.equal(github.connected, false);
  assert.deepEqual(github.capabilities, ["search_github"]);
});

test("OAuth uses PKCE, validates one-use state, and stores tokens locally", async () => {
  const { registry, credentialStore } = await fixture(async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/token") {
      const body = new URLSearchParams(init.body);
      assert.ok(body.get("code_verifier"));
    }
    return new Response(JSON.stringify(path === "/token"
      ? { access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600 }
      : { jsonrpc: "2.0", id: "test", result: { tools: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, { authentication: "oauth" });
  const start = await registry.connect("sample");
  const authorization = new URL(start.authorizationURL);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const state = authorization.searchParams.get("state");
  await assert.rejects(() => registry.completeOAuth({ state: "wrong", code: "abc" }), /state/);
  await registry.completeOAuth({ state, code: "abc" });
  assert.equal((await credentialStore.getRecord("connector.sample")).accessToken, "access-secret");
  await assert.rejects(() => registry.completeOAuth({ state, code: "abc" }), /state/);
});

test("Dia domains and insecure remote connector endpoints are rejected", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-connectors-"));
  const manifests = resolve(directory, "connectors");
  await mkdir(manifests);
  await writeFile(resolve(manifests, "blocked.json"), JSON.stringify({
    id: "blocked",
    endpoint: "https://api.diabrowser.com/mcp",
    authentication: "none",
  }));
  const registry = new ConnectorRegistry({
    stateStore: new AppsStateStore(resolve(directory, "apps.json")),
    credentialStore: new CredentialStore(resolve(directory, "credentials.json")),
    manifestDirectory: manifests,
  });
  await registry.initialize();
  assert.throws(() => registry.manifest("blocked"), /unknown connector/);
});

test("custom connectors require an explicit destination allowlist", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-custom-connectors-"));
  const manifests = resolve(directory, "connectors");
  await mkdir(manifests);
  await writeFile(resolve(manifests, "unbounded.json"), JSON.stringify({
    id: "unbounded",
    endpoint: "https://example.com/mcp",
    authentication: "none",
  }));
  const registry = new ConnectorRegistry({
    stateStore: new AppsStateStore(resolve(directory, "apps.json")),
    credentialStore: new CredentialStore(resolve(directory, "credentials.json")),
    manifestDirectory: manifests,
  });
  await registry.initialize();
  assert.throws(() => registry.manifest("unbounded"), /unknown connector/);
});
