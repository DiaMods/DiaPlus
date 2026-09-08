import { assertAllowedConnectorURL } from "../network-policy.js";

async function readJSON(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OAuth response has no body");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 256 * 1024) throw new Error("OAuth metadata exceeds 256 KiB");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function oauthJSON(url, manifest, fetchImplementation, options = {}) {
  const response = await fetchImplementation(assertAllowedConnectorURL(url, manifest.allowedDomains), {
    ...options, redirect: "error", headers: { accept: "application/json", ...options.headers }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const error = new Error(`OAuth endpoint returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return readJSON(response);
}

function metadataCandidates(issuer) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/$/, "");
  return [...new Set([
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ])];
}

async function firstMetadata(urls, manifest, fetchImplementation) {
  for (const url of urls) {
    try { return await oauthJSON(url, manifest, fetchImplementation); }
    catch (error) { if (![404, 405].includes(error.status)) throw error; }
  }
  throw new Error("OAuth metadata was not found; supply the OAuth endpoints and client ID in settings");
}

// RFC 9728 protected resources, RFC 8414/OIDC discovery and RFC 7591 public
// client registration. All discovered destinations still require the user's allowlist.
export async function discoverOAuth(manifest, { fetchImplementation = fetch, callbackURL, registered } = {}) {
  const configured = manifest.oauth ?? {};
  if (configured.authorizationURL && configured.tokenURL && configured.clientID) {
    return { ...configured, resource: configured.resource ?? manifest.endpoint };
  }
  const endpoint = new URL(manifest.endpoint);
  const probe = await fetchImplementation(assertAllowedConnectorURL(endpoint.toString(), manifest.allowedDomains), {
    method: "GET", redirect: "error", headers: { accept: "application/json, text/event-stream" }, signal: AbortSignal.timeout(15_000),
  });
  const challenge = probe.headers.get("www-authenticate") ?? "";
  await probe.body?.cancel().catch(() => {});
  const metadataURL = /\bresource_metadata\s*=\s*"([^"\\]*)"/i.exec(challenge)?.[1];
  const scopeChallenge = /\bscope\s*=\s*"([^"\\]*)"/i.exec(challenge)?.[1];
  const resource = await firstMetadata(metadataURL ? [metadataURL] : [...new Set([
    `${endpoint.origin}/.well-known/oauth-protected-resource${endpoint.pathname === "/" ? "" : endpoint.pathname}`,
    `${endpoint.origin}/.well-known/oauth-protected-resource`,
  ])], manifest, fetchImplementation);
  const canonicalResource = assertAllowedConnectorURL(resource.resource, manifest.allowedDomains).toString();
  if (canonicalResource !== endpoint.toString()) throw new Error("OAuth protected-resource metadata does not match the MCP endpoint");
  if (!Array.isArray(resource.authorization_servers) || !resource.authorization_servers.length) throw new Error("OAuth protected resource has no authorization server");
  const issuer = assertAllowedConnectorURL(configured.issuer ?? resource.authorization_servers[0], manifest.allowedDomains).toString();
  if (!resource.authorization_servers.some((value) => new URL(value).toString() === issuer)) throw new Error("Configured OAuth issuer is not advertised by this resource");
  const metadata = await firstMetadata(metadataCandidates(issuer), manifest, fetchImplementation);
  if (!metadata.issuer || new URL(metadata.issuer).toString() !== issuer) throw new Error("OAuth authorization-server issuer mismatch");
  if (!metadata.code_challenge_methods_supported?.includes("S256")) throw new Error("OAuth server must advertise PKCE S256 support");
  if (metadata.token_endpoint_auth_methods_supported && !metadata.token_endpoint_auth_methods_supported.includes("none")) throw new Error("OAuth server must support public clients (token endpoint auth method none)");
  const authorizationURL = assertAllowedConnectorURL(metadata.authorization_endpoint, manifest.allowedDomains).toString();
  const tokenURL = assertAllowedConnectorURL(metadata.token_endpoint, manifest.allowedDomains).toString();
  const revocationURL = metadata.revocation_endpoint ? assertAllowedConnectorURL(metadata.revocation_endpoint, manifest.allowedDomains).toString() : null;
  let clientID = configured.clientID || (registered?.issuer === issuer && registered?.resource === canonicalResource ? registered.clientID : null);
  if (!clientID) {
    if (!metadata.registration_endpoint) throw new Error("OAuth server has no public dynamic registration endpoint; enter a registered client ID in settings");
    const registration = await oauthJSON(metadata.registration_endpoint, manifest, fetchImplementation, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        client_name: "Dia Custom", redirect_uris: [callbackURL], grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], token_endpoint_auth_method: "none",
      }),
    });
    if (typeof registration.client_id !== "string" || !registration.client_id || registration.client_id.length > 4000 ||
      (registration.token_endpoint_auth_method && registration.token_endpoint_auth_method !== "none")) throw new Error("OAuth registration did not return a public client ID");
    if (registration.redirect_uris && !registration.redirect_uris.includes(callbackURL)) throw new Error("OAuth registration did not accept the local callback");
    clientID = registration.client_id;
  }
  const scopes = configured.scopes?.length ? configured.scopes
    : scopeChallenge !== undefined ? scopeChallenge.split(/\s+/).filter(Boolean)
      : Array.isArray(resource.scopes_supported) ? resource.scopes_supported.filter((scope) => typeof scope === "string") : [];
  return { authorizationURL, tokenURL, revocationURL, clientID, scopes, issuer, resource: canonicalResource };
}
