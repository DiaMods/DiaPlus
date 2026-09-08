import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { discoverOAuth } from "../src/connectors/oauth-discovery.js";
import { ConnectorRegistry, credentialRecordID, validateManifest } from "../src/connectors/registry.js";
import { AppsStateStore } from "../src/apps-state.js";
import { CredentialStore } from "../src/credentials.js";

const endpoint = "https://mcp.example.com/service/mcp";
const issuer = "https://auth.example.com/tenant";
const callbackURL = "http://127.0.0.1:8765/api/apps/oauth/callback";
const manifest = validateManifest({ id: "discovery", endpoint, allowedDomains: ["mcp.example.com", "auth.example.com"], authentication: "oauth" });
const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

function fixture({ challenge = true, pkce = true, wrongIssuer = false, crossHost = false, oidc = false } = {}) {
  const requests = [];
  const fetchImplementation = async (rawURL, init = {}) => {
    const url = new URL(rawURL);
    requests.push({ url: url.toString(), ...init });
    assert.equal(init.redirect, "error");
    if (url.toString() === endpoint) {
      if (init.method !== "POST") return new Response(null, { status: 401, headers: challenge ? { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.com/metadata", scope="notes:read"' } : {} });
      const request = JSON.parse(init.body);
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
      return json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize" ? { protocolVersion: "2025-11-25" } : { tools: [] } });
    }
    if (url.pathname === "/metadata" || url.pathname === "/.well-known/oauth-protected-resource/service/mcp") return json({ resource: endpoint, authorization_servers: [issuer], scopes_supported: ["notes:all"] });
    if (url.pathname === "/.well-known/oauth-authorization-server/tenant" && oidc) return new Response(null, { status: 404 });
    if (["/.well-known/oauth-authorization-server/tenant", "/.well-known/openid-configuration/tenant"].includes(url.pathname)) return json({ issuer: wrongIssuer ? "https://auth.example.com/other" : issuer,
      authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      registration_endpoint: crossHost ? "https://untrusted.example.net/register" : `${issuer}/register`,
      code_challenge_methods_supported: pkce ? ["S256"] : ["plain"], token_endpoint_auth_methods_supported: ["none"],
    });
    if (url.pathname === "/tenant/register") {
      const body = JSON.parse(init.body);
      assert.equal(body.token_endpoint_auth_method, "none");
      assert.deepEqual(body.redirect_uris, [callbackURL]);
      return json({ client_id: "registered-client", token_endpoint_auth_method: "none", redirect_uris: [callbackURL] });
    }
    if (url.pathname === "/tenant/token") {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("resource"), endpoint);
      assert.equal(body.get("client_id"), "registered-client");
      if (body.get("grant_type") === "authorization_code") assert.ok(body.get("code_verifier"));
      return json({ access_token: "token-from-discovery", refresh_token: "refresh-from-discovery", token_type: "Bearer", expires_in: 3600 });
    }
    throw new Error(`Unexpected OAuth fixture endpoint: ${url}`);
  };
  return { fetchImplementation, requests };
}

test("OAuth discovers protected resources and authorization metadata, verifies PKCE and registers a public client", async () => {
  const { fetchImplementation, requests } = fixture();
  const oauth = await discoverOAuth(manifest, { fetchImplementation, callbackURL });
  assert.equal(oauth.clientID, "registered-client");
  assert.equal(oauth.resource, endpoint);
  assert.deepEqual(oauth.scopes, ["notes:read"]);
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), ["/service/mcp", "/metadata", "/.well-known/oauth-authorization-server/tenant", "/tenant/register"]);
});

test("OAuth supports path-based well-known fallback and OIDC metadata without re-registering an existing client", async () => {
  const { fetchImplementation, requests } = fixture({ challenge: false, oidc: true });
  const oauth = await discoverOAuth(manifest, { fetchImplementation, callbackURL, registered: { issuer, resource: endpoint, clientID: "existing-client" } });
  assert.equal(oauth.clientID, "existing-client");
  assert.deepEqual(oauth.scopes, ["notes:all"]);
  assert.ok(requests.some((request) => request.url.includes("openid-configuration")));
  assert.ok(!requests.some((request) => request.url.endsWith("register")));
});

test("OAuth refuses unknown destinations, issuer mismatches, and servers without S256", async () => {
  for (const [options, expected] of [[{ crossHost: true }, /allowed domain/], [{ wrongIssuer: true }, /issuer mismatch/], [{ pkce: false }, /S256/]]) {
    const { fetchImplementation, requests } = fixture(options);
    await assert.rejects(discoverOAuth(manifest, { fetchImplementation, callbackURL }), expected);
    assert.ok(requests.every((request) => !request.url.includes("untrusted")));
  }
});

test("discovered OAuth configuration survives callback, refresh and reconnect in the credential store", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "dia-oauth-discovery-"));
  const { fetchImplementation, requests } = fixture();
  let now = Date.now();
  const registry = new ConnectorRegistry({ stateStore: new AppsStateStore(resolve(directory, "state.json")), credentialStore: new CredentialStore(resolve(directory, "credentials.json")), manifestDirectory: resolve(directory, "connectors"), fetchImplementation, callbackBaseURL: callbackURL, now: () => now });
  t.after(async () => { registry.close(); await rm(directory, { recursive: true, force: true }); });
  await registry.initialize();
  await registry.addManifest(manifest);
  const start = await registry.connect("discovery", { profileID: "Work" });
  const url = new URL(start.authorizationURL);
  assert.equal(url.searchParams.get("resource"), endpoint);
  await registry.completeOAuth({ state: url.searchParams.get("state"), code: "fixture-code" });
  const record = await registry.credentialStore.getRecord(credentialRecordID("Work", "discovery"));
  assert.equal(record.oauth.clientID, "registered-client");
  assert.equal(record.accessToken, "token-from-discovery");
  now += 4_000_000;
  assert.equal(await registry.accessToken(registry.manifest("discovery"), { profileID: "Work" }), "token-from-discovery");
  await registry.connect("discovery", { profileID: "Work" });
  assert.equal(requests.filter((request) => request.url.endsWith("/register")).length, 1);
  assert.equal(requests.filter((request) => request.url.endsWith("/token")).length, 2);
});
