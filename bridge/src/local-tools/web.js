import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isDiaHost } from "../network-policy.js";

const maximumBodyBytes = 2 * 1024 * 1024;
const maximumRedirects = 5;
const userAgent = "DiaCustom/1.0 (local browser assistant)";

const webToolDefinitions = [
  {
    name: "mcp__dia-tools__search_web",
    description: "Search the public internet through Dia Custom's localhost bridge. Results come directly from a public search engine and never pass through Dia or The Browser Company.",
    input_schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: { type: "string" },
          description: "Public web search queries",
        },
      },
      required: ["queries"],
      additionalProperties: false,
    },
    source: "local",
  },
  {
    name: "mcp__dia-tools__fetch_web_content",
    description: "Fetch readable content directly from public HTTP(S) URLs through Dia Custom's localhost bridge. Private-network and Dia-owned destinations are blocked.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: { type: "string", format: "uri" },
        },
      },
      required: ["urls"],
      additionalProperties: false,
    },
    source: "local",
  },
];

function ipv4IsPrivate(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function ipv6IsPrivate(address) {
  const normalized = address.toLowerCase().split("%")[0];
  let expanded = normalized;
  const dotted = expanded.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const bytes = dotted.split(".").map(Number);
    expanded = expanded.slice(0, -dotted.length) +
      `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = expanded.split("::");
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const words = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right]
    .map((word) => Number.parseInt(word || "0", 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    return true;
  }
  if (words.every((word) => word === 0) ||
      (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const mapped = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join(".");
    return ipv4IsPrivate(mapped);
  }
  const first = words[0];
  return (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (words[0] === 0x2001 && words[1] === 0x0db8);
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return ipv4IsPrivate(address);
  if (family === 6) return ipv6IsPrivate(address);
  return true;
}

export async function assertPublicWebURL(rawURL, lookupImplementation = lookup) {
  const url = new URL(rawURL);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`web tools only support HTTP(S), not ${url.protocol}`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || isDiaHost(hostname)) {
    throw new Error(`web tools refuse destination ${hostname || "<empty>"}`);
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupImplementation(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`could not resolve public destination ${hostname}`);
  }
  const blocked = addresses.find(({ address }) => isPrivateAddress(address));
  if (blocked) {
    throw new Error(`web tools refuse private or reserved address ${blocked.address}`);
  }
  return url;
}

function decodeEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function readableHTML(html) {
  return decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:p|div|section|article|header|footer|main|aside|li|h[1-6]|br|tr|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? readableHTML(match[1]).slice(0, 300) : "";
}

async function boundedBody(response) {
  if (!response.body) return { body: "", bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maximumBodyBytes - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total = maximumBodyBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), bytes: total, truncated };
}

async function fetchPublicText(
  rawURL,
  { fetchImplementation, lookupImplementation },
  redirectCount = 0,
) {
  const url = await assertPublicWebURL(rawURL, lookupImplementation);
  const response = await fetchImplementation(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml,application/json,text/plain,application/xml;q=0.9,*/*;q=0.1",
      "accept-encoding": "identity",
      "user-agent": userAgent,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectCount >= maximumRedirects) throw new Error("too many web redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error(`HTTP ${response.status} redirect omitted Location`);
    return fetchPublicText(new URL(location, url).toString(), {
      fetchImplementation,
      lookupImplementation,
    }, redirectCount + 1);
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${url.hostname}`);
    if ([401, 403].includes(response.status)) error.requiresBrowserSession = true;
    throw error;
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const supported = contentType.startsWith("text/") || [
    "application/json", "application/ld+json", "application/xhtml+xml",
    "application/xml", "application/rss+xml", "application/atom+xml",
  ].includes(contentType);
  if (!supported) throw new Error(`unsupported web content type ${contentType || "unknown"}`);
  const value = await boundedBody(response);
  return { ...value, url: url.toString(), contentType };
}

function looksLikeLoginWall(page) {
  if (!page?.contentType?.includes("html")) return false;
  let pathname = "";
  try {
    pathname = new URL(page.url).pathname;
  } catch {
    // The URL was already validated before fetching; this is defensive only.
  }
  if (/(?:^|\/)(?:login|log-in|signin|sign-in|auth)(?:\/|$)/i.test(pathname)) return true;
  const html = page.body ?? "";
  const hasCredentialField = /<input\b[^>]*\btype\s*=\s*["']?(?:password|email)["']?/i.test(html);
  const hasLoginLanguage = /\b(?:sign|log)\s+in\b|\bauthenticate\b|\bcontinue with (?:google|apple|microsoft)\b/i.test(
    `${htmlTitle(html)}\n${readableHTML(html).slice(0, 2_000)}`,
  );
  return hasCredentialField && hasLoginLanguage;
}

function resultURL(rawHref) {
  try {
    const href = decodeEntities(rawHref);
    const url = new URL(href, "https://html.duckduckgo.com/");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return null;
  }
}

export function parseDuckDuckGoResults(html, limit = 8) {
  const links = [...html.matchAll(
    /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )];
  return links.slice(0, limit).flatMap((match) => {
    const url = resultURL(match[1]);
    if (!url) return [];
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 5000);
    const snippetMatch = tail.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    return [{
      title: readableHTML(match[2]),
      url,
      snippet: snippetMatch ? readableHTML(snippetMatch[1]) : "",
    }];
  });
}

export class LocalWebTools {
  constructor({
    fetchImplementation = fetch,
    lookupImplementation = lookup,
  } = {}) {
    this.fetch = fetchImplementation;
    this.lookup = lookupImplementation;
  }

  definitions() {
    return webToolDefinitions.map((tool) => structuredClone(tool));
  }

  async search(input) {
    const queries = Array.isArray(input?.queries)
      ? input.queries.filter((query) => typeof query === "string" && query.trim()).slice(0, 5)
      : [];
    if (queries.length === 0) throw new Error("search_web requires at least one query");
    const searches = await Promise.all(queries.map(async (query) => {
      const url = new URL("https://html.duckduckgo.com/html/");
      url.searchParams.set("q", query.trim());
      const page = await fetchPublicText(url, {
        fetchImplementation: this.fetch,
        lookupImplementation: this.lookup,
      });
      return { query: query.trim(), results: parseDuckDuckGoResults(page.body) };
    }));
    return { provider: "DuckDuckGo HTML", searches };
  }

  async fetchContent(input) {
    const urls = Array.isArray(input?.urls)
      ? input.urls.filter((url) => typeof url === "string" && url.trim()).slice(0, 10)
      : [];
    if (urls.length === 0) throw new Error("fetch_web_content requires at least one URL");
    const pages = await Promise.all(urls.map(async (url) => {
      try {
        const page = await fetchPublicText(url, {
          fetchImplementation: this.fetch,
          lookupImplementation: this.lookup,
        });
        const isHTML = page.contentType.includes("html");
        if (looksLikeLoginWall(page)) {
          return {
            url,
            finalURL: page.url,
            title: isHTML ? htmlTitle(page.body) : "",
            error: "The public fetch reached a login wall; read this URL in the signed-in browser session.",
            requiresBrowserSession: true,
          };
        }
        return {
          url: page.url,
          title: isHTML ? htmlTitle(page.body) : "",
          content: isHTML ? readableHTML(page.body) : page.body,
          contentType: page.contentType,
          bytes: page.bytes,
          truncated: page.truncated,
        };
      } catch (error) {
        return {
          url,
          error: String(error?.message ?? error),
          ...(error?.requiresBrowserSession ? { requiresBrowserSession: true } : {}),
        };
      }
    }));
    return { pages };
  }

  async execute(name, input) {
    if (name.endsWith("search_web")) return this.search(input);
    if (name.endsWith("fetch_web_content")) return this.fetchContent(input);
    throw new Error(`unknown local web tool: ${name}`);
  }
}

export function isLocalWebTool(name) {
  return [
    "search_web",
    "fetch_web_content",
    "mcp__dia-tools__search_web",
    "mcp__dia-tools__fetch_web_content",
  ].includes(name);
}
