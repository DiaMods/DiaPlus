import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  artifactOutboundURLs,
  authorizeArtifactUpload,
  authorizeNativeToolCalls,
  currentAgentContextID,
  inspectArtifactOutboundURLs,
  isTrustedArtifactSiteRoot,
  nativeToolSafetyEvents,
  normalizeReportKitHTML,
} from "../src/artifact-safety.js";

const contextID = "E53B9BE3-F23C-4C0E-987B-30921F6BA109";

async function fixture() {
  const profile = await mkdtemp(resolve(tmpdir(), "dia-custom-artifact-"));
  const root = resolve(
    profile,
    "User Data/Default/AgentServer/contexts",
    contextID,
    "work/artifacts/report-test",
  );
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "index.html"), `
    <link rel="stylesheet" href="style.css">
    <main>Local Report fixture</main>
  `);
  return { profile, root };
}

test("Report safety metadata only whitelists a real current-context artifact", async () => {
  const { profile, root } = await fixture();
  await writeFile(resolve(root, "sources.js"), `
    const source = "https://example.com/source";
  `);
  assert.equal(await isTrustedArtifactSiteRoot(root, profile, { contextID }), true);
  const lookupImplementation = async () => [{ address: "93.184.216.34", family: 4 }];
  assert.deepEqual(await artifactOutboundURLs(root, { lookupImplementation }), [
    "https://example.com/source",
  ]);
  const [event] = await nativeToolSafetyEvents([{
    id: "toolu_report",
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }], profile, { lookupImplementation, contextID });
  assert.deepEqual(event.data.allowed_artifact_urls, ["https://example.com/source"]);
  assert.deepEqual(event.data.client_can_bypass, []);
  const authorization = await authorizeArtifactUpload({
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile, { contextID, requireContext: true, lookupImplementation });
  assert.equal(authorization.allowed, true);
  assert.equal(authorization.files, 2);
});

test("Report upload treats a blank root path as index.html and localizes Report Kit Chart.js", async () => {
  const { profile, root } = await fixture();
  const reportKitChartURL =
    "https://artifactcdn.diabrowser.engineering/ajax/libs/Chart.js/chart.umd.js";
  await writeFile(resolve(root, "index.html"), `
    <main>Chart report</main>
    <script src="${reportKitChartURL}"></script>
  `);
  const lookupImplementation = async () => [{ address: "93.184.216.34", family: 4 }];

  const authorization = await authorizeArtifactUpload({
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: "" },
  }, profile, { contextID, requireContext: true, lookupImplementation });

  assert.equal(authorization.allowed, true);
  assert.equal(authorization.entryPath, await realpath(resolve(root, "index.html")));
  const localizedHTML = await readFile(resolve(root, "index.html"), "utf8");
  assert.doesNotMatch(localizedHTML, /artifactcdn\.diabrowser\.engineering/);
  assert.match(localizedHTML, /\.\/\.dia-custom-libs\/chart\.umd\.js/);
  await access(resolve(root, ".dia-custom-libs/chart.umd.js"));

  const rootAuthorization = await authorizeArtifactUpload({
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: root },
  }, profile, { contextID, requireContext: true, lookupImplementation });
  assert.equal(rootAuthorization.allowed, true);
  assert.equal(rootAuthorization.entryPath, await realpath(resolve(root, "index.html")));
});

test("Report upload restores Report Kit's native shell after a fragment-only revision", async () => {
  const { profile, root } = await fixture();
  await writeFile(resolve(root, "index.html"), `
    <!-- report-kit -->
    <div class="report"><div class="report-wrap"><h1>Revised report</h1></div></div>
  `);
  const authorization = await authorizeArtifactUpload({
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile, {
    contextID,
    requireContext: true,
    lookupImplementation: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(authorization.allowed, true);
  const normalized = await readFile(resolve(root, "index.html"), "utf8");
  assert.match(normalized, /^<!DOCTYPE html>/);
  assert.match(normalized, /<head>[\s\S]*<meta charset="UTF-8">/);
  assert.match(normalized, /<meta name="viewport"/);
  assert.match(normalized, /<link rel="stylesheet" href="style\.css">/);
  assert.match(normalized, /<body>[\s\S]*<!-- report-kit -->/);
  assert.match(normalized, /<\/body>\n<\/html>\n$/);

  assert.equal(normalizeReportKitHTML(normalized), normalized);
  assert.equal(normalizeReportKitHTML("<html>ordinary artifact</html>"),
    "<html>ordinary artifact</html>");
});

test("Report upload rejects unresolved image examples and uninitialized canvases", async () => {
  const { profile, root } = await fixture();
  await writeFile(resolve(root, "index.html"), `
    <!-- report-kit -->
    <html><head><link rel="stylesheet" href="style.css"></head><body>
      <img src="IMAGE_URL" alt="Example copied from Report Kit">
      <canvas id="chart-1"></canvas>
    </body></html>
  `);
  const authorization = await authorizeArtifactUpload({
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile, {
    contextID,
    requireContext: true,
    lookupImplementation: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(authorization.allowed, false);
  assert.match(authorization.reason, /unfinished visuals/);
  assert.match(authorization.reason, /IMAGE_URL/);
  assert.match(authorization.reason, /canvas visual/);
});

test("Report upload accepts bundled images, initialized charts, and inline SVG diagrams", async () => {
  const { profile, root } = await fixture();
  await mkdir(resolve(root, "assets"));
  await writeFile(resolve(root, "assets/diagram.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  await writeFile(resolve(root, "index.html"), `
    <!-- report-kit -->
    <html><head><link rel="stylesheet" href="style.css"></head><body>
      <img src="assets/diagram.svg" alt="Bundled diagram">
      <svg viewBox="0 0 100 100" role="img"><title>Inline diagram</title></svg>
      <canvas id="chart-1"></canvas>
      <script>new Chart(document.getElementById("chart-1"), { type: "bar", data: {} });</script>
    </body></html>
  `);
  const authorization = await authorizeArtifactUpload({
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile, {
    contextID,
    requireContext: true,
    lookupImplementation: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(authorization.allowed, true);
});

test("Report upload must match the native request's current agent context", async () => {
  const { profile, root } = await fixture();
  const payload = {
    messages: [{
      role: "user",
      content: `<agent-context>\n<agent-id>a-test</agent-id>\n<working-directory>${resolve(root, "../..")}</working-directory>\n</agent-context>\n<user-message>Make a Report</user-message>`,
    }],
  };
  assert.equal(currentAgentContextID(payload, profile), contextID);
  assert.equal(currentAgentContextID({ messages: [] }, profile), null);

  const wrongContext = "11111111-2222-3333-4444-555555555555";
  assert.equal(await isTrustedArtifactSiteRoot(root, profile, { contextID: wrongContext }), false);
  const missingContext = await authorizeArtifactUpload({
    name: "upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile, { requireContext: true });
  assert.equal(missingContext.allowed, false);
  assert.match(missingContext.reason, /trusted current Dia agent context/);
});

test("Report authorization scans nested text assets and rejects blocked outbound URLs", async () => {
  const { profile, root } = await fixture();
  await mkdir(resolve(root, "assets"));
  await writeFile(resolve(root, "assets/styles.css"), `
    .avatar { background: url("https://artifactcdn.diabrowser.engineering/private.png") }
  `);
  const lookupImplementation = async () => [{ address: "93.184.216.34", family: 4 }];
  const outbound = await inspectArtifactOutboundURLs(root, { lookupImplementation });
  assert.equal(outbound.allowed.length, 0);
  assert.equal(outbound.blocked[0].url, "https://artifactcdn.diabrowser.engineering/private.png");

  const authorization = await authorizeArtifactUpload({
    name: "upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile, { contextID, requireContext: true, lookupImplementation });
  assert.equal(authorization.allowed, false);
  assert.match(authorization.reason, /blocked outbound URL/);
});

test("Report safety metadata rejects paths outside the context boundary and symlinks", async () => {
  const { profile, root } = await fixture();
  const outside = resolve(profile, "outside");
  await mkdir(outside);
  await writeFile(resolve(outside, "index.html"), "outside");
  assert.equal(await isTrustedArtifactSiteRoot(outside, profile), false);

  const linked = resolve(root, "../linked-report");
  await symlink(outside, linked);
  assert.equal(await isTrustedArtifactSiteRoot(linked, profile), false);

  const [event] = await nativeToolSafetyEvents([{
    id: "toolu_bad",
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: outside },
  }], profile);
  assert.deepEqual(event.data.allowed_artifact_urls, []);
  assert.deepEqual(event.data.client_can_bypass, []);

  const authorization = await authorizeNativeToolCalls([{
    name: "mcp__dia-tools__upload_artifact",
    input: { site_root: outside, relative_path: "index.html" },
  }], profile);
  assert.equal(authorization.allowed.length, 0);
  assert.match(authorization.blocked[0].reason, /current Dia agent context/);
});

test("Report authorization rejects nested symlinks and escaped entry paths", async () => {
  const { profile, root } = await fixture();
  const outside = resolve(profile, "secret.txt");
  await writeFile(outside, "secret");
  await symlink(outside, resolve(root, "linked.txt"));

  const linkedTree = await authorizeArtifactUpload({
    name: "upload_artifact",
    input: { site_root: root, relative_path: "index.html" },
  }, profile);
  assert.equal(linkedTree.allowed, false);
  assert.match(linkedTree.reason, /symbolic links/);

  const escaped = await authorizeArtifactUpload({
    name: "upload_artifact",
    input: { site_root: root, relative_path: "../../../../../../secret.txt" },
  }, profile);
  assert.equal(escaped.allowed, false);
});
