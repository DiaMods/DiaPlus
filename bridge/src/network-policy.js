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

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function assertAllowedConnectorURL(rawURL, allowedDomains = []) {
  const url = assertAllowedProviderURL(rawURL);
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("remote connector URLs must use HTTPS");
  }
  const domains = allowedDomains.map((value) => String(value).toLowerCase().replace(/^\./, ""));
  if (domains.length > 0 && !domains.some((domain) =>
    url.hostname.toLowerCase() === domain || url.hostname.toLowerCase().endsWith(`.${domain}`))) {
    throw new Error(`connector destination is not in its allowed domain list: ${url.hostname}`);
  }
  return url;
}

export function joinProviderURL(baseURL, path) {
  const base = assertAllowedProviderURL(baseURL);
  const normalizedBase = base.toString().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return assertAllowedProviderURL(`${normalizedBase}${normalizedPath}`).toString();
}
