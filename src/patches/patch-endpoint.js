import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPatchableCustomApp } from "./custom-app-guard.js";

const app = process.argv[2]
  ? resolve(process.argv[2])
  : "";
assertPatchableCustomApp(app);
const executable = resolve(app, "Contents/MacOS/Dia");
const mappings = [
  {
    source: Buffer.from("https://tools-cache.diabrowser.engineering"),
    replacement: Buffer.from("http://localhost:8765/tools-cache-local-xx"),
  },
  {
    source: Buffer.from("https://aiproxy.diabrowser.engineering/api/dia-claude-stream"),
    replacement: Buffer.from("http://localhost:8765/aiproxy/dia-claude-stream-local-testxx"),
  },
  {
    source: Buffer.from("https://webresultproxy.diabrowser.engineering/api/claude-stream"),
    replacement: Buffer.from("http://localhost:8765/webresultproxy/claude-stream-local-xxxxxx"),
  },
  {
    source: Buffer.from("https://webresultproxy.diabrowser.engineering/api/open-ai-chat-stream"),
    replacement: Buffer.from("http://localhost:8765/webresultproxy/open-ai-chat-stream-local-xxxxxx"),
  },
  {
    source: Buffer.from("https://ai-service.diabrowser.engineering/aiproxy"),
    replacement: Buffer.from("http://localhost:8765/aiproxy/custom-provider-v1x"),
  },
  {
    source: Buffer.from("https://ai-service.diabrowser.engineering"),
    replacement: Buffer.from("http://localhost:8765/ai-service-local-v1"),
  },
  {
    source: Buffer.from("https://model-server.browserinternalstaging.com"),
    replacement: Buffer.from("http://localhost:8765/model-registry-local-xxxx"),
  },
  {
    source: Buffer.from("https://browser-intake-datadoghq.com"),
    replacement: Buffer.from("http://localhost:8765/dd-local-xxxxx"),
  },
  {
    source: Buffer.from("https://20e2d6c8c914f5debbbeda6e32769711@o298668.ingest.us.sentry.io/4507817683058688"),
    replacement: Buffer.from("http://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@localhost:8765/4507817683058688"),
  },
];

for (const { source, replacement } of mappings) {
  if (source.length !== replacement.length) {
    throw new Error(`endpoint lengths differ: ${source.length} vs ${replacement.length}`);
  }
}

const data = await readFile(executable);
let patchedCount = 0;

function countOccurrences(haystack, needle) {
  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const offset = haystack.indexOf(needle, cursor);
    if (offset === -1) break;
    count += 1;
    cursor = offset + needle.length;
  }
  return count;
}

for (const { source, replacement } of mappings) {
  const sourceCount = countOccurrences(data, source);
  const replacementCount = countOccurrences(data, replacement);
  if (sourceCount === 0 && replacementCount === 1) {
    continue;
  }
  if (sourceCount !== 1 || replacementCount !== 0) {
    throw new Error(
      `expected one unpatched endpoint '${source.toString()}', found source=${sourceCount}, replacement=${replacementCount}`,
    );
  }
  replacement.copy(data, data.indexOf(source));
  patchedCount += 1;
}

await writeFile(executable, data);
process.stdout.write(`Patched ${patchedCount} native AI endpoint(s) in ${executable}\n`);
