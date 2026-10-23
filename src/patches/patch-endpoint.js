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
const dynamicAIService = ["87864", "88564", "88592", "88879"].includes(build);
const isDia153 = ["88564", "88592", "88879"].includes(build);
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
    replacement: Buffer.from(dynamicAIService
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
const isDia150 = ["87561", "87864", "88564", "88592", "88879"].includes(build);

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
  if (isDia153 && source.toString() === "https://model-server.browserinternalstaging.com") {
    if (sourceCount !== 0 || replacementCount !== 0) {
      throw new Error("Dia 1.53 unexpectedly contains the removed model-server endpoint");
    }
    continue;
  }
  if (isDia150 && source.toString() === "https://tools-cache.diabrowser.engineering") {
    if (sourceCount !== 0 || replacementCount !== 0) {
      throw new Error("Dia 1.50 unexpectedly contains the removed tools-cache endpoint");
    }
    continue;
  }
  if (isDia150 && source.toString() === "https://ai-service.diabrowser.engineering") {
    // In 1.50 this prefix occurs only inside the /aiproxy URL, already
    // validated and rewritten by the preceding mapping.
    if (sourceCount !== 0 || replacementCount !== Number(dynamicAIService)) {
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

if (dynamicAIService) {
  // BackendServices constructs AIService URLs dynamically in 1.51/1.53. Redirect
  // only enum 1, retaining native path construction and the indirect URL ABI.
  // Other services tail-call the original resolver. The adjacent context
  // destructor tail-shares an independently audited, identical destructor;
  // only its now-unreachable body is used for the local URL continuation.
  const branch = (from, to) => {
    const value = Buffer.alloc(4);
    value.writeUInt32LE((0x14000000 | ((to - from) / 4 & 0x03ffffff)) >>> 0);
    return value;
  };
  const layout = build === "87864" ? {
    resolver: 0xf68794, destructor: 0xf687b0, sharedDestructor: 0x8cac8,
    literal: 0x60cee90, textEnd: 0x5b41638,
    destructorBody: "fd030091800a40f9449a2f95e00314aa01038052e2008052fd7bc1a86c9a2f15",
    localContinuation: "200680d20000faf2218b02d021c03991210041b21d672f151f2003d51f2003d5",
    guards: [
      [0x8cac8, "fd7bbfa9fd030091800a40f97e096b95e00314aa01038052e2008052fd7bc1a8a6096b15"],
      [0x5b4243c, "90890090103647f900021fd6"],
      [0xf6734c, "fc0f1af8fb6b01a9f96302a9f75b03a9f44f04a9fd7b05a9"],
      [0x2ce6674, "74820691e80318aa20008052e10316aaf50317aabb018a97f70315aa60d640f9"],
    ],
  } : build === "88879" ? {
    resolver: 0xfbf39c, destructor: 0xfbf3b8, sharedDestructor: 0x8bfd4,
    literal: 0x61e1cf0, textEnd: 0x5ceaac0,
    destructorBody: "fd030091800a40f9fbe33495e00314aa01038052e2008052fd7bc1a823e43415",
    localContinuation: "200680d20000faf2019102d021403391210041b240b134151f2003d51f2003d5",
    guards: [
      [0x8bfd4, "fd7bbfa9fd030091800a40f9f4b07195e00314aa01038052e2008052fd7bc1a81cb17115"],
      [0x5ceb8d0, "f08a00f010e246f900021fd6"],
      [0xfbdf54, "fc0f1af8fb6b01a9f96302a9f75b03a9f44f04a9fd7b05a9"],
      [0x2f66614, "74820691e80318aa20008052e10316aaf50317aad55c8197f70315aa60d640f9"],
    ],
  } : build === "88592" ? {
    resolver: 0xfb160c, destructor: 0xfb1628, sharedDestructor: 0x8c040,
    literal: 0x60f7e80, textEnd: 0x5c0c5fc,
    destructorBody: "fd030091800a40f9bfa13195e00314aa01038052e2008052fd7bc1a8e7a13115",
    localContinuation: "200680d20000faf2218a02d021803991210041b26a6f31151f2003d51f2003d5",
    guards: [
      [0x8c040, "fd7bbfa9fd030091800a40f939376e95e00314aa01038052e2008052fd7bc1a861376e15"],
      [0x5c0d3e8, "d08900b010ea45f900021fd6"],
      [0xfb01c4, "fc0f1af8fb6b01a9f96302a9f75b03a9f44f04a9fd7b05a9"],
      [0x2ef0cd4, "74820691e80318aa20008052e10316aaf50317aac1fb8297f70315aa60d640f9"],
    ],
  } : {
    resolver: 0xfb09bc, destructor: 0xfb09d8, sharedDestructor: 0x8c040,
    literal: 0x60f7520, textEnd: 0x5c0bcd0,
    destructorBody: "fd030091800a40f988a23195e00314aa01038052e2008052fd7bc1a8b0a23115",
    // The native String representation still uses the literal's 32-byte bias;
    // URL(string:) keeps its indirect return ABI. Only enum 1 is redirected.
    localContinuation: "200680d20000faf2218a02f021001491210041b2337031151f2003d51f2003d5",
    guards: [
      [0x8c040, "fd7bbfa9fd030091800a40f9ee346e95e00314aa01038052e2008052fd7bc1a816356e15"],
      [0x5c0cabc, "d08900d010ea45f900021fd6"],
      [0xfaf574, "fc0f1af8fb6b01a9f96302a9f75b03a9f44f04a9fd7b05a9"],
      [0x2ef0144, "74820691e80318aa20008052e10316aaf50317aa91fb8297f70315aa60d640f9"],
    ],
  };
  for (const [guardOffset, guard] of layout.guards) {
    if (!data.subarray(guardOffset, guardOffset + guard.length / 2).equals(Buffer.from(guard, "hex"))) {
      throw new Error(`Dia ${build} AI service URL ABI changed at 0x${guardOffset.toString(16)}`);
    }
  }
  const localURL = Buffer.from("http://localhost:8765/ai-service-local-v1/native0\0");
  if (!data.subarray(layout.literal, layout.literal + localURL.length).equals(localURL)) {
    throw new Error(`Dia ${build} AI service base URL literal moved`);
  }
  const patches = [
    [layout.resolver, "fd7bbfa9fd030091810a40f982624039eafaff97fd7bc1a8c0035fd6",
      Buffer.from("1f040071e0000054810a40f982624039eafaff171f2003d51f2003d5", "hex")],
    [layout.destructor, "fd7bbfa9", branch(layout.destructor, layout.sharedDestructor)],
    [layout.destructor + 4, layout.destructorBody, Buffer.from(layout.localContinuation, "hex")],
  ];
  const sign = (value, bits) => value & (1 << (bits - 1)) ? value - 2 ** bits : value;
  for (let offset = 0x3200; offset < layout.textEnd; offset += 4) {
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
    if (target !== null && target >= layout.destructor + 4 && target < layout.destructor + 36 &&
        !(offset === layout.resolver + 4 && target === layout.destructor + 4)) {
      throw new Error(`Dia ${build} AI service URL continuation gained a reference from 0x${offset.toString(16)}`);
    }
  }
  for (const [offset, original, replacement] of patches) {
    const current = data.subarray(offset, offset + replacement.length);
    if (!current.equals(replacement)) {
      if (requirePatched || !current.equals(Buffer.from(original, "hex"))) {
        throw new Error(`Dia ${build} AI service URL redirect is missing or changed at 0x${offset.toString(16)}`);
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
  process.stdout.write(`Validated ${mappings.length - 2 * Number(isDia150) - Number(isDia153) + Number(dynamicAIService)} native AI endpoint(s) in ${executable}\n`);
} else {
  await writeFile(executable, data);
  process.stdout.write(`Patched ${patchedCount} native AI endpoint(s) in ${executable}\n`);
}
