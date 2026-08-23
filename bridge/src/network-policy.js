const forbiddenHostSuffixes = [
  ".diabrowser.engineering",
  ".diabrowser.com",
  ".thebrowser.company",
  ".thebrowser.com",
  ".browserinternal.com",
  ".browserinternalstaging.com",
];

const forbiddenHosts = new Set([
  "diabrowser.engineering",
  "diabrowser.com",
  "thebrowser.company",
  "thebrowser.com",
  "browserinternal.com",
  "browserinternalstaging.com",
]);

export function isDiaHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return forbiddenHosts.has(normalized) ||
    forbiddenHostSuffixes.some((suffix) => normalized.endsWith(suffix));
}

export function isAllowedLoopbackHostHeader(value, port = 8765) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]).has(normalized);
}

export function assertAllowedProviderURL(rawURL) {
  const url = new URL(rawURL);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`unsupported provider URL protocol: ${url.protocol}`);
  }
  if (isDiaHost(url.hostname)) {
    throw new Error(`Dia Custom refuses provider traffic to ${url.hostname}`);
  }
  return url;
}

export function joinProviderURL(baseURL, path) {
  const base = assertAllowedProviderURL(baseURL);
  const normalizedBase = base.toString().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return assertAllowedProviderURL(`${normalizedBase}${normalizedPath}`).toString();
}
