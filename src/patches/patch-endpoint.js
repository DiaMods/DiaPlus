import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertPatchableCustomApp } from "./custom-app-guard.js";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const requirePatched = args.includes("--require-patched");
const appArguments = args.filter((arg) => !arg.startsWith("--"));
if (appArguments.length !== 1 || args.some((arg) => arg.startsWith("--") &&
    !["--check", "--require-patched"].includes(arg)) || requirePatched && !checkOnly) {
  throw new Error("usage: patch-endpoint.js [--check [--require-patched]] /path/to/Dia.app");
}
const app = resolve(appArguments[0]);
if (!checkOnly) assertPatchableCustomApp(app);
const executable = resolve(app, "Contents/MacOS/Dia");
const build = execFileSync("/usr/libexec/PlistBuddy", [
  "-c", "Print :CFBundleVersion", resolve(app, "Contents/Info.plist"),
], { encoding: "utf8" }).trim();
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
    replacement: Buffer.from(build === "87864"
      ? "http://localhost:8765/ai-service-local-v1/native0"
      : "http://localhost:8765/aiproxy/custom-provider-v1x"),
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
// Dia 1.50 removed the legacy tools-cache endpoint. Keep the other eight
// endpoints guarded, and reject a reappearance or a partially patched copy.
const isDia150 = ["87561", "87864"].includes(build);

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
  if (isDia150 && source.toString() === "https://tools-cache.diabrowser.engineering") {
    if (sourceCount !== 0 || replacementCount !== 0) {
      throw new Error("Dia 1.50 unexpectedly contains the removed tools-cache endpoint");
    }
    continue;
  }
  if (isDia150 && source.toString() === "https://ai-service.diabrowser.engineering") {
    // In 1.50 this prefix occurs only inside the /aiproxy URL, already
    // validated and rewritten by the preceding mapping.
    if (sourceCount !== 0 || replacementCount !== Number(build === "87864")) {
      throw new Error("Dia 1.50 unexpectedly contains a standalone ai-service endpoint");
    }
    continue;
  }
  if (sourceCount === 0 && replacementCount === 1) {
    continue;
  }
  if (requirePatched) {
    throw new Error(`required native AI endpoint patch is missing: ${source.toString()}`);
  }
  if (sourceCount !== 1 || replacementCount !== 0) {
    throw new Error(
      `expected one unpatched endpoint '${source.toString()}', found source=${sourceCount}, replacement=${replacementCount}`,
    );
  }
  replacement.copy(data, data.indexOf(source));
  patchedCount += 1;
}

if (build === "87864") {
  // BackendServices constructs AIService URLs dynamically in 1.51. Redirect
  // only enum 1, retaining native path construction and the indirect URL ABI.
  // Other services tail-call the original resolver. The adjacent context
  // destructor tail-shares an independently audited, identical destructor;
  // only its now-unreachable body is used for the local URL continuation.
  const branch = (from, to) => {
    const value = Buffer.alloc(4);
    value.writeUInt32LE((0x14000000 | ((to - from) / 4 & 0x03ffffff)) >>> 0);
    return value;
  };
  for (const [guardOffset, guard] of [
    [0x8cac8, "fd7bbfa9fd030091800a40f97e096b95e00314aa01038052e2008052fd7bc1a8a6096b15"],
    [0x5b4243c, "90890090103647f900021fd6"],
    [0xf6734c, "fc0f1af8fb6b01a9f96302a9f75b03a9f44f04a9fd7b05a9"],
    [0x2ce6674, "74820691e80318aa20008052e10316aaf50317aabb018a97f70315aa60d640f9"],
  ]) {
    if (!data.subarray(guardOffset, guardOffset + guard.length / 2).equals(Buffer.from(guard, "hex"))) {
      throw new Error(`Dia 87864 AI service URL ABI changed at 0x${guardOffset.toString(16)}`);
    }
  }
  const localURL = Buffer.from("http://localhost:8765/ai-service-local-v1/native0\0");
  if (!data.subarray(0x60cee90, 0x60cee90 + localURL.length).equals(localURL)) {
    throw new Error("Dia 87864 AI service base URL literal moved");
  }
  const patches = [
    [0xf68794, "fd7bbfa9fd030091810a40f982624039eafaff97fd7bc1a8c0035fd6",
      Buffer.from("1f040071e0000054810a40f982624039eafaff171f2003d51f2003d5", "hex")],
    [0xf687b0, "fd7bbfa9", branch(0xf687b0, 0x8cac8)],
    [0xf687b4, "fd030091800a40f9449a2f95e00314aa01038052e2008052fd7bc1a86c9a2f15",
      Buffer.from("200680d20000faf2218b02d021c03991210041b21d672f151f2003d51f2003d5", "hex")],
  ];
  const sign = (value, bits) => value & (1 << (bits - 1)) ? value - 2 ** bits : value;
  for (let offset = 0x3200; offset < 0x5b41638; offset += 4) {
    const word = data.readUInt32LE(offset);
    let target = null;
    if (((word & 0x7c000000) >>> 0) === 0x14000000) {
      target = offset + sign(word & 0x03ffffff, 26) * 4;
    } else if (((word & 0xff000010) >>> 0) === 0x54000000 ||
               ((word & 0x7e000000) >>> 0) === 0x34000000) {
      target = offset + sign((word >>> 5) & 0x7ffff, 19) * 4;
    } else if (((word & 0x7e000000) >>> 0) === 0x36000000) {
      target = offset + sign((word >>> 5) & 0x3fff, 14) * 4;
    } else if (((word & 0x9f000000) >>> 0) === 0x90000000) {
      const next = data.readUInt32LE(offset + 4);
      if (((next & 0xffc00000) >>> 0) === 0x91000000 &&
          ((next >>> 5) & 31) === (word & 31)) {
        target = (offset & ~4095) + sign(((word >>> 5) & 0x7ffff) * 4 +
          ((word >>> 29) & 3), 21) * 4096 + ((next >>> 10) & 4095);
      }
    } else if (((word & 0x9f000000) >>> 0) === 0x10000000) {
      target = offset + sign(((word >>> 5) & 0x7ffff) * 4 + ((word >>> 29) & 3), 21);
    }
    if (target !== null && target >= 0xf687b4 && target < 0xf687d4 &&
        !(offset === 0xf68798 && target === 0xf687b4)) {
      throw new Error(`Dia 87864 AI service URL continuation gained a reference from 0x${offset.toString(16)}`);
    }
  }
  for (const [offset, original, replacement] of patches) {
    const current = data.subarray(offset, offset + replacement.length);
    if (!current.equals(replacement)) {
      if (requirePatched || !current.equals(Buffer.from(original, "hex"))) {
        throw new Error(`Dia 87864 AI service URL redirect is missing or changed at 0x${offset.toString(16)}`);
      }
      replacement.copy(data, offset);
      patchedCount += 1;
    }
  }
}

// Checking simulates the same ordered replacements in memory. This matters
// because the ai-service base URL is also a prefix of its /aiproxy endpoint.
// Both original and fully patched candidates must satisfy the exact byte/count
// checks above; inspecting an official or signed app must never modify it.
if (checkOnly) {
  process.stdout.write(`Validated ${mappings.length - 2 * Number(isDia150) + Number(build === "87864")} native AI endpoint(s) in ${executable}\n`);
} else {
  await writeFile(executable, data);
  process.stdout.write(`Patched ${patchedCount} native AI endpoint(s) in ${executable}\n`);
}
