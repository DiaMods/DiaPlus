import { copyFile, lstat, mkdir, opendir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { contentAsText, systemAsText } from "./chat-shape.js";
import { assertPublicWebURL } from "./local-tools/web.js";

const contextIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const artifactFolderPattern = /^[a-z0-9][a-z0-9._-]{0,199}$/i;
const maximumArtifactFiles = 1_000;
const maximumArtifactBytes = 50 * 1024 * 1024;
const maximumSafetyScanBytes = 8 * 1024 * 1024;
const maximumOutboundURLs = 250;
const inspectableExtensions = new Set([
  ".css", ".htm", ".html", ".js", ".json", ".mjs", ".svg", ".xml",
]);
const bridgeDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localArtifactLibraries = new Map([
  [
    "https://artifactcdn.diabrowser.engineering/ajax/libs/Chart.js/chart.umd.js",
    {
      source: resolve(bridgeDirectory, "node_modules/chart.js/dist/chart.umd.js"),
      destination: ".dia-custom-libs/chart.umd.js",
    },
  ],
]);

function isInside(parent, child) {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

function payloadText(payload) {
  const messages = Array.isArray(payload?.messages)
    ? payload.messages.map((message) => contentAsText(message?.content)).join("\n")
    : "";
  return `${systemAsText(payload?.system)}\n${messages}`;
}

export function currentAgentContextID(payload, profileDirectory) {
  if (!profileDirectory) return null;
  const text = payloadText(payload);
  const explicitContext = /<agent-context>\s*<agent-id>[^<]*<\/agent-id>\s*<working-directory>([^<]+)<\/working-directory>\s*<\/agent-context>/i
    .exec(text)?.[1];
  if (!explicitContext) return null;

  const contextsRoot = resolve(
    profileDirectory,
    "User Data/Default/AgentServer/contexts",
  );
  const contextRelative = relative(contextsRoot, resolve(explicitContext));
  const components = contextRelative.split(sep);
  if (components.length !== 2 || components[1] !== "work" ||
      !contextIDPattern.test(components[0])) {
    return null;
  }
  return components[0];
}

export async function isTrustedArtifactSiteRoot(
  siteRoot,
  profileDirectory,
  { contextID = null } = {},
) {
  if (typeof siteRoot !== "string" || !siteRoot.startsWith(sep) || !profileDirectory) {
    return false;
  }

  const contextsRoot = resolve(
    profileDirectory,
    "User Data/Default/AgentServer/contexts",
  );
  const candidate = resolve(siteRoot);
  const lexicalRelative = relative(contextsRoot, candidate);
  const components = lexicalRelative.split(sep);
  if (
    components.length !== 4 ||
    !contextIDPattern.test(components[0]) ||
    (contextID !== null && components[0].toLowerCase() !== contextID.toLowerCase()) ||
    components[1] !== "work" ||
    components[2] !== "artifacts" ||
    !artifactFolderPattern.test(components[3]) ||
    basename(candidate) !== components[3]
  ) {
    return false;
  }

  try {
    const [realContextsRoot, realCandidate, rootStat, indexStat] = await Promise.all([
      realpath(contextsRoot),
      realpath(candidate),
      lstat(candidate),
      lstat(resolve(candidate, "index.html")),
    ]);
    return isInside(realContextsRoot, realCandidate) &&
      rootStat.isDirectory() && !rootStat.isSymbolicLink() &&
      indexStat.isFile() && !indexStat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function inspectArtifactTree(root, { collectFiles = false } = {}) {
  const pending = [root];
  const filePaths = [];
  let files = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = resolve(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        throw new Error("Report folders may not contain symbolic links");
      }
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error("Report folders may only contain regular files and directories");
      }
      files += 1;
      bytes += stat.size;
      if (collectFiles) filePaths.push(path);
      if (files > maximumArtifactFiles || bytes > maximumArtifactBytes) {
        throw new Error("Report exceeds the local 1,000-file or 50 MiB safety limit");
      }
    }
  }
  return { files, bytes, ...(collectFiles ? { filePaths } : {}) };
}

async function localizeKnownArtifactLibraries(root) {
  const { filePaths } = await inspectArtifactTree(root, { collectFiles: true });
  const copied = new Set();
  for (const path of filePaths) {
    if (!inspectableExtensions.has(extname(path).toLowerCase())) continue;
    const contents = await readFile(path);
    if (contents.includes(0)) continue;
    let text = contents.toString("utf8");
    let changed = false;
    for (const [remoteURL, library] of localArtifactLibraries) {
      if (!text.includes(remoteURL)) continue;
      const destination = resolve(root, library.destination);
      if (!copied.has(destination)) {
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(library.source, destination);
        copied.add(destination);
      }
      const localReference = relative(dirname(path), destination)
        .split(sep).join("/");
      text = text.replaceAll(
        remoteURL,
        localReference.startsWith("../") || localReference.startsWith("./")
          ? localReference
          : `./${localReference}`,
      );
      changed = true;
    }
    if (changed) await writeFile(path, text);
  }
  return copied.size;
}

export async function authorizeArtifactUpload(
  toolCall,
  profileDirectory,
  { contextID = null, requireContext = false, lookupImplementation } = {},
) {
  if (!toolCall?.name?.endsWith("upload_artifact")) {
    return { allowed: true };
  }
  const siteRoot = toolCall.input?.site_root;
  if (requireContext && !contextIDPattern.test(contextID ?? "")) {
    return {
      allowed: false,
      reason: "the native request did not contain a trusted current Dia agent context",
    };
  }
  if (!await isTrustedArtifactSiteRoot(siteRoot, profileDirectory, { contextID })) {
    return {
      allowed: false,
      reason: "site_root must be a real report directory inside the current Dia agent context's work/artifacts folder",
    };
  }

  const requestedRelativePath = toolCall.input?.relative_path;
  let relativePath = requestedRelativePath;
  if (
    relativePath === undefined ||
    relativePath === null ||
    (typeof relativePath === "string" && ["", ".", "./"].includes(relativePath.trim())) ||
    (typeof relativePath === "string" &&
      relativePath.startsWith(sep) &&
      resolve(relativePath) === resolve(siteRoot))
  ) {
    // Dia's native upload_artifact contract defines a blank/root path as the
    // site's index.html. Preserve that contract instead of rejecting a valid
    // model-generated Report at the final handoff.
    relativePath = "index.html";
  }
  if (typeof relativePath !== "string" || relativePath.startsWith(sep)) {
    return { allowed: false, reason: "relative_path must name a file inside site_root" };
  }
  try {
    const [realRoot, realEntry] = await Promise.all([
      realpath(siteRoot),
      realpath(resolve(siteRoot, relativePath)),
    ]);
    const entryStat = await lstat(realEntry);
    if (!isInside(realRoot, realEntry) || !entryStat.isFile() || entryStat.isSymbolicLink()) {
      return { allowed: false, reason: "relative_path must resolve to a regular file inside site_root" };
    }
    await localizeKnownArtifactLibraries(realRoot);
    const tree = await inspectArtifactTree(realRoot);
    const outbound = await inspectArtifactOutboundURLs(realRoot, { lookupImplementation });
    if (outbound.blocked.length > 0) {
      const first = outbound.blocked[0];
      return {
        allowed: false,
        reason: `Report contains a blocked outbound URL (${first.url}): ${first.reason}`,
      };
    }
    return { allowed: true, siteRoot: realRoot, entryPath: realEntry, ...tree };
  } catch (error) {
    return { allowed: false, reason: String(error?.message ?? error) };
  }
}

export async function authorizeNativeToolCalls(toolCalls, profileDirectory, options = {}) {
  const allowed = [];
  const blocked = [];
  for (const call of toolCalls ?? []) {
    const authorization = await authorizeArtifactUpload(call, profileDirectory, options);
    if (authorization.allowed) allowed.push(call);
    else blocked.push({ call, reason: authorization.reason });
  }
  return { allowed, blocked };
}

function candidateURLs(text) {
  const decoded = text
    .replace(/&#(?:x0*3a|0*58);/gi, ":")
    .replace(/&#(?:x0*2f|0*47);/gi, "/");
  return [...decoded.matchAll(/https?:\/\/[^\s"'`<>()\\]+/gi)]
    .map((match) => match[0].replace(/[\],.;:!?}]+$/g, ""));
}

export async function inspectArtifactOutboundURLs(
  siteRoot,
  { lookupImplementation } = {},
) {
  const { filePaths } = await inspectArtifactTree(siteRoot, { collectFiles: true });
  const candidates = [];
  let scannedBytes = 0;
  for (const path of filePaths) {
    if (!inspectableExtensions.has(extname(path).toLowerCase())) continue;
    const contents = await readFile(path);
    scannedBytes += contents.byteLength;
    if (scannedBytes > maximumSafetyScanBytes) {
      throw new Error("Report text exceeds the 8 MiB outbound-URL safety inspection limit");
    }
    // NUL bytes indicate a binary payload with a misleading extension.
    if (contents.includes(0)) continue;
    candidates.push(...candidateURLs(contents.toString("utf8")));
    if (candidates.length > maximumOutboundURLs) {
      throw new Error("Report contains more than 250 outbound URLs");
    }
  }

  const allowed = [];
  const blocked = [];
  for (const rawURL of [...new Set(candidates)]) {
    try {
      const url = await assertPublicWebURL(rawURL, lookupImplementation);
      allowed.push(url.toString());
    } catch (error) {
      blocked.push({
        url: rawURL,
        reason: String(error?.message ?? error),
      });
    }
  }
  return { allowed, blocked, scannedBytes };
}

export async function artifactOutboundURLs(siteRoot, options = {}) {
  return (await inspectArtifactOutboundURLs(siteRoot, options)).allowed;
}

export async function nativeToolSafetyEvents(
  toolCalls,
  profileDirectory,
  { lookupImplementation, contextID = null } = {},
) {
  const events = [];
  for (const toolCall of toolCalls) {
    if (!toolCall.name.endsWith("upload_artifact") ||
        typeof toolCall.input?.site_root !== "string") {
      continue;
    }
    const trusted = await isTrustedArtifactSiteRoot(
      toolCall.input.site_root,
      profileDirectory,
      { contextID },
    );
    const allowedArtifactURLs = trusted
      ? await artifactOutboundURLs(toolCall.input.site_root, { lookupImplementation })
      : [];
    events.push({
      event: "tool_safety_check_result",
      data: {
        type: "tool_safety_check_result",
        tool_id: toolCall.id,
        tool_type: "upload_artifact",
        // Dia keys this list by site_root, but its values are outbound URLs
        // embedded in the artifact. The filesystem root itself is not a URL.
        allowed_artifact_urls: allowedArtifactURLs,
        client_can_bypass: [],
      },
    });
  }
  return events;
}
