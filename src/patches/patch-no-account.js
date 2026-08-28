#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argumentsAfterScript = process.argv.slice(2);
const appArgument = argumentsAfterScript.find((argument) => !argument.startsWith("--"));
const checkOnly = argumentsAfterScript.includes("--check");
const capabilitiesOnly = argumentsAfterScript.includes("--capabilities-only");
const anonymousOnly = argumentsAfterScript.includes("--anonymous-only");
if (capabilitiesOnly && anonymousOnly) {
  throw new Error("choose either --capabilities-only or --anonymous-only");
}
const appPath = appArgument ? path.resolve(appArgument) : "";
const executable = path.join(appPath, "Contents", "MacOS", "Dia");

if (!checkOnly && (
  path.basename(path.dirname(appPath)) !== "work" ||
  !path.basename(appPath).startsWith("Dia Custom")
)) {
  throw new Error(`refusing to patch a non-clone executable: ${executable}`);
}

const build = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleVersion", path.join(appPath, "Contents", "Info.plist")],
  { encoding: "utf8" },
).trim();
const bytes = (hex) => Buffer.from(hex, "hex");
const nop = bytes("1f2003d5");

const layouts = {
  "85660": {
    accountStateGuard: 0x075588c,
    capabilityGateOne: 0x07cf6b8,
    capabilityGateTwo: 0x07e24b4,
    accountState: 0x2c6c5e8,
    authenticationMethod: 0x0756908,
    modelTokenFailure: {
      offset: 0x3fec870,
      expected: "e05240f91d3c5694000000900030299104000014",
      replacement: "e00314aa7d3c5694ff5a00f9150080d21300fcd2",
    },
    authClientConstructor: {
      offset: 0x2c534ac,
      replacement: "22a78c97",
    },
    restoreAnonymousFallback: {
      offset: 0x0f7d134,
      expected:
        "f44fbea9fd7b01a9fd430091ff0313d1f30308aaa8fffff008712991e87f02a9" +
        "683802b008411c91e87f03a9a8fffff008f12c91e87f04a9e0830091e1230091" +
        "22008052",
      alternate:
        "f44fbea9fd7b01a9fd430091f30308aabeffff97e10300aae00313aa024a8052" +
        "96f717954885ffb008311291687e06a9687e08a9687e0ba9fd7b41a9f44fc2a8" +
        "c0035fd6",
    },
    keyVerification: 0x2a0604c,
    cliaClosures: [0x0f7d1c8, 0x0f7d1e0, 0x0f7d204],
    cliaExpected: "6885ffd008912991",
    cliaReplacement: "4885ffb008311291",
  },
  "85823": {
    accountStateGuard: 0x0758afc,
    capabilityGateOne: 0x07d17b0,
    capabilityGateTwo: 0x07e339c,
    accountState: 0x2d342ec,
    authenticationMethod: 0x0759b78,
    modelTokenFailure: {
      offset: 0x41290b0,
      expected: "e05240f9d26456940000009000300a9104000014",
      replacement: "e00314aa32655694ff5a00f9150080d21300fcd2",
    },
    authClientConstructor: {
      offset: 0x2d1b1a0,
      replacement: "2a268a97",
    },
    keyVerification: 0x2ad19f8,
    cliaClosures: [0x0fa4adc, 0x0fa4af4, 0x0fa4b18],
    cliaExpected: "2884fff008112991",
    cliaReplacement: "0884ffd008311291",
  },
  "86064": {
    accountStateGuard: 0x0758b14,
    capabilityGateOne: 0x07d1968,
    capabilityGateTwo: 0x07e3554,
    accountState: 0x2d3c390,
    authenticationMethod: 0x0759b90,
    modelTokenFailure: {
      offset: 0x41343d4,
      expected: "e05240f96d7756940000009000c0169104000014",
      replacement: "e00314aacd775694ff5a00f9150080d21300fcd2",
    },
    authClientConstructor: {
      offset: 0x2d23244,
      replacement: "a00d8a97",
    },
    keyVerification: 0x2ad9a9c,
    cliaClosures: [0x0fa6958, 0x0fa6970, 0x0fa6994],
    cliaExpected: "2884ffb008112991",
    cliaReplacement: "0884ff9008311291",
  },
};

const layout = layouts[build];
if (!layout) {
  throw new Error(
    `unsupported Dia build ${build}; account patches are audited only for ${Object.keys(layouts).join(", ")}`,
  );
}

const patches = [
  {
    scope: "anonymous",
    offset: layout.accountStateGuard,
    expected: bytes("c0d24a39"),
    replacement: bytes("c0d24a39"),
  },
  { scope: "capability", offset: layout.capabilityGateOne, expected: bytes("d31a0036"), replacement: nop },
  { scope: "capability", offset: layout.capabilityGateTwo, expected: bytes("d6170036"), replacement: nop },
  {
    scope: "anonymous",
    offset: layout.accountState,
    expected: bytes("fa67bba9"),
    replacement: bytes("20008052"),
  },
  {
    scope: "anonymous",
    offset: layout.accountState + 4,
    expected: bytes("f85f01a9"),
    replacement: bytes("c0035fd6"),
  },
  {
    scope: "anonymous",
    offset: layout.authenticationMethod,
    expected: bytes("bd0344b2"),
    alternates: [bytes("c10640f9")],
    replacement: bytes("c10640f9"),
  },
  {
    scope: "anonymous",
    offset: layout.authenticationMethod + 4,
    expected: bytes("ffc300d1"),
    alternates: [
      bytes("00008052"),
      bytes("20008052"),
      bytes("40008052"),
      bytes("60008052"),
    ],
    // AuthenticationMethod: 0 = signUp, 1 = signIn, 2 = restored.
    replacement: bytes("40008052"),
  },
  {
    scope: "anonymous",
    offset: layout.authenticationMethod + 8,
    expected: bytes("f5cf00a9"),
    replacement: bytes("140080d2"),
  },
  {
    scope: "anonymous",
    offset: layout.authenticationMethod + 12,
    expected: bytes("fd7b02a9"),
    replacement: bytes("20001fd6"),
  },
  {
    scope: "capability",
    // Treat a missing Dia account token as an empty Swift String, releasing
    // the discarded error before the original success continuation runs.
    offset: layout.modelTokenFailure.offset,
    expected: bytes(layout.modelTokenFailure.expected),
    replacement: bytes(layout.modelTokenFailure.replacement),
  },
  {
    scope: "anonymous",
    // Use Dia's anonymous AuthClient dependency instead of AuthClientImpl.
    offset: layout.authClientConstructor.offset,
    expected: bytes("a2feff97"),
    replacement: bytes(layout.authClientConstructor.replacement),
  },
  ...(layout.restoreAnonymousFallback ? [{
    scope: "anonymous",
    // Build 85660 was used during an earlier UI-test identity experiment.
    // Accept that alternate and restore the ordinary anonymous constructor.
    offset: layout.restoreAnonymousFallback.offset,
    expected: bytes(layout.restoreAnonymousFallback.expected),
    alternates: [bytes(layout.restoreAnonymousFallback.alternate)],
    replacement: bytes(layout.restoreAnonymousFallback.expected),
  }] : []),
  {
    scope: "capability",
    // Keep parsing and ECDH, but accept the localhost bridge's ephemeral key
    // without Dia's production-only long-term signing key.
    offset: layout.keyVerification,
    expected: bytes("40090036"),
    replacement: nop,
  },
  ...layout.cliaClosures.map((offset) => ({
    scope: "capability",
    // The anonymous dependency's Clia flags use a constant-true closure.
    offset,
    expected: bytes(layout.cliaExpected),
    replacement: bytes(layout.cliaReplacement),
  })),
];

const selectedPatches = patches.filter((patch) =>
  !capabilitiesOnly && !anonymousOnly ||
  capabilitiesOnly && patch.scope === "capability" ||
  anonymousOnly && patch.scope === "anonymous");
const data = fs.readFileSync(executable);
for (const patch of selectedPatches) {
  const current = data.subarray(
    patch.offset,
    patch.offset + patch.replacement.length,
  );
  if (current.equals(patch.replacement)) {
    continue;
  }
  const matchesAlternate = patch.alternates?.some((candidate) => current.equals(candidate));
  if (!current.equals(patch.expected) && !matchesAlternate) {
    throw new Error(
      `unexpected instruction for Dia ${build} at 0x${patch.offset.toString(16)}: ${current.toString("hex")}`,
    );
  }
  patch.replacement.copy(data, patch.offset);
}

if (checkOnly) {
  console.log(`Validated the audited ${capabilitiesOnly ? "local capability" : anonymousOnly ? "anonymous account" : "account"} patch layout for Dia build ${build}`);
} else {
  fs.writeFileSync(executable, data);
  console.log(`${capabilitiesOnly ? "Enabled account-independent local AI" : anonymousOnly ? "Disabled the Dia-account requirement" : "Patched local AI and the Dia-account gate"} for build ${build} in ${executable}`);
}
