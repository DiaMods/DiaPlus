// Keep connector administration separate from the native unauthenticated Apps
// state feed. Every configuration, credential, and discovery action is local-admin only.
export async function handleConnectorAPI(request, response, requestURL, {
  registry, hasAdminToken, isEnabled, readBody, jsonResponse,
}) {
  const collection = requestURL.pathname === "/api/apps/connectors";
  const resource = requestURL.pathname.match(/^\/api\/apps\/connectors\/([^/]+)(?:\/(connect|reconnect|disconnect|tools|sync))?$/);
  if (!collection && !resource) return false;
  try {
    if (!await hasAdminToken(request)) {
      jsonResponse(response, 403, { error: "invalid local administration token" });
      return true;
    }
    if (!isEnabled()) throw new Error("live-connectors mod is disabled");
    const action = resource?.[2];
    if ((collection && request.method !== "POST") ||
        (resource && request.method !== (action ? "POST" : "DELETE"))) {
      jsonResponse(response, 405, { error: "method_not_allowed" });
      return true;
    }
    const connectorID = resource ? decodeURIComponent(resource[1]) : null;
    if (!collection && !action) {
      await registry.removeManifest(connectorID);
      jsonResponse(response, 200, { ok: true });
      return true;
    }
    const payload = JSON.parse((await readBody(request)).toString("utf8") || "{}");
    if (typeof payload?.profileID !== "string" || !payload.profileID.trim() ||
        !/^[^/\\\0]{1,120}$/.test(payload.profileID.trim())) {
      throw new Error("a valid profileID is required");
    }
    const options = { profileID: payload.profileID.trim() };
    let value;
    if (collection) {
      const connector = await registry.addManifest(payload.manifest, options);
      value = { ok: true, connector };
    } else if (action === "tools") {
      value = { tools: await registry.discoverTools(connectorID, { ...options, force: true }) };
    } else if (action === "sync") {
      value = await registry.sync(connectorID, options);
    } else if (action === "disconnect") {
      value = await registry.disconnect(connectorID, options);
    } else {
      value = await registry.connect(connectorID, { ...options, token: payload.token, ...(payload.environment !== undefined ? { environment: payload.environment } : {}) });
    }
    jsonResponse(response, 200, value);
  } catch (error) {
    jsonResponse(response, 400, { error: String(error?.message ?? error) });
  }
  return true;
}
