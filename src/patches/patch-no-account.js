#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertPatchableCustomApp } from "./custom-app-guard.js";

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

if (!checkOnly) assertPatchableCustomApp(appPath);

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
  "86261": {
    accountStateGuard: 0x075362c,
    accountStateGuardExpected: "c0524439",
    capabilityGateOne: 0x07d73dc,
    capabilityGateOneExpected: "131c0036",
    capabilityGateTwo: 0x07e9994,
    accountState: 0x29b2374,
    authenticationMethod: 0x0754674,
    modelTokenFailure: {
      offset: 0x423dc44,
      expected: "e05240f996c25694000000900080389104000014",
      replacement: "e00314aaf6c25694ff5a00f9150080d21300fcd2",
    },
    authClientConstructor: {
      offset: 0x2998ecc,
      expected: "9efeff97",
      replacement: "0c9a9897",
    },
    keyVerification: 0x284d024,
    cliaClosures: [0x0fbf790, 0x0fbf7a8, 0x0fbf7cc],
    cliaExpected: "6883ff9008412891",
    cliaReplacement: "2883fff008611191",
  },
  "86584": {
    accountStateGuard: 0x075cdb0,
    accountStateGuardExpected: "c0524439",
    capabilityGateOne: 0x07e45fc,
    capabilityGateOneExpected: "131c0036",
    capabilityGateTwo: 0x07f68a8,
    accountState: 0x2a3efc8,
    authenticationMethod: 0x075ddf8,
    modelTokenFailure: {
      offset: 0x42f2e24,
      expected: "e05240f9eba85794000000b00000009104000014",
      replacement: "e00314aa4ba95794ff5a00f9150080d21300fcd2",
    },
    authClientConstructor: {
      offset: 0x2a257a4,
      expected: "9efeff97",
      replacement: "9ac89697",
    },
    keyVerification: 0x28dcd18,
    cliaClosures: [0x0fd7aa0, 0x0fd7ab8, 0x0fd7adc],
    cliaExpected: "a882ff9008712891",
    cliaReplacement: "6882fff008611191",
  },
  "86796": {
    accountStateGuard: 0x075d048,
    accountStateGuardExpected: "c0524439",
    capabilityGateOne: 0x07e48a4,
    capabilityGateOneExpected: "131c0036",
    capabilityGateTwo: 0x07f6b50,
    accountState: 0x2a42300,
    authenticationMethod: 0x075e090,
    modelTokenFailure: {
      offset: 0x42f3528,
      expected: "e05240f961ba57940000009000101c9104000014",
      replacement: "e00314aa61ba5794ff5a00f9150080d21300fcd2",
    },
    authClientConstructor: {
      offset: 0x2a28adc,
      expected: "9efeff97",
      replacement: "cbc29697",
    },
    keyVerification: 0x28e0044,
    cliaClosures: [0x0fd969c, 0x0fd96b4, 0x0fd96d8],
    cliaExpected: "8882ffd008712891",
    cliaReplacement: "6882ffb008611191",
  },
  "87561": {
    accountStateGuard: 0x075cd8c,
    accountStateGuardExpected: "c0f24439",
    capabilityGateOne: 0x07e440c,
    capabilityGateOneExpected: "131d0036",
    capabilityGateTwo: 0x07f7bcc,
    capabilityGateTwoExpected: "36190036",
    accountState: 0x2dd504c,
    accountStateExpected: "fc6fbaa9",
    accountStateNextExpected: "fa6701a9",
    authenticationMethod: 0x075e6ec,
    modelTokenFailure: {
      offset: 0x452e85c,
      expected: "00000090",
      codeCave: 0x5aeeca4,
      returnOffset: 0x452e868,
      releaseStub: 0x5aee158,
    },
    keyVerification: 0x2a12e64,
    keyVerificationExpected: "20090036",
    authClientConstructor: {
      offset: 0x2dbbd08,
      expected: "bdfeff97",
      // Preserve AuthClientImpl's per-subscriber streams. The anonymous
      // dependency shares one AsyncThrowingStream across concurrent consumers
      // in 1.50+, which traps on the second next(). State/method gates below
      // retain local restored mode without replacing that dependency.
      replacement: "bdfeff97",
    },
    cliaClosures: [
      { offset: 0x0f609c0, expected: "4886fff008b10391", replacement: "2886ffb008c12091" },
      { offset: 0x0f609d8, expected: "4886fff008b10391", replacement: "2886ffb008c12091" },
      { offset: 0x0f609fc, expected: "280000b008710b91", replacement: "2886ffb008c12091" },
    ],
  },
  "87864": {
    accountStateGuard: 0x0767238,
    accountStateGuardExpected: "c0f24439",
    capabilityGateOne: 0x07f10e0,
    capabilityGateOneExpected: "131d0036",
    capabilityGateTwo: 0x0804e34,
    capabilityGateTwoExpected: "36190036",
    accountState: 0x2e13ba4,
    accountStateExpected: "fc6fbaa9",
    accountStateNextExpected: "fa6701a9",
    authenticationMethod: 0x0768b98,
    modelTokenFailure: {
      offset: 0x45b3618,
      expected: "00000090",
      // The old 24-byte import-stub padding is gone in 1.51. Reuse only
      // this token callback's error continuation, made unreachable by the
      // selector redirect. Exact caller/continuation guards below are required.
      codeCave: 0x45b37fc,
      codeCaveExpected: "bd0344b2ff4302d1fcef03a9fae704a9f8df05a9f5cf06a9",
      returnOffset: 0x45b3624,
      releaseStub: 0x5b4f24c,
    },
    keyVerification: 0x2ce46ac,
    keyVerificationExpected: "20090036",
    // AuthenticatedURLLoadRequestProvider's async authentication gate.
    // Use its native no-auth continuation for local routing; keep the request,
    // response parsing, ECDH encryption and independent account streams intact.
    localRequestAuthentication: [
      { offset: 0xf2b788, expected: "bd0344b2f70f1df8f5cf00a9fd7b02a9f60f00f9fd830091", replacement: "bd0344b2f70f1df8f5cf00a9fd7b02a9f60f00f9fd830091" },
      { offset: 0xf2b7a0, expected: "e1020036", replacement: "17000014" },
      { offset: 0xf2b7fc, expected: "c00640f9140080d2fd7b42a9f5cf40a9f70743f8bdfb439200001fd6", replacement: "c00640f9140080d2fd7b42a9f5cf40a9f70743f8bdfb439200001fd6" },
    ],
    authClientConstructor: {
      offset: 0x2dfa1c8,
      expected: "b9feff97",
      replacement: "b9feff97",
    },
    cliaClosures: [
      { offset: 0x0f785a0, expected: "8885ffd008412891", replacement: "6885ffb008f10b91" },
      { offset: 0x0f785b8, expected: "8885ffd008412891", replacement: "6885ffb008f10b91" },
      { offset: 0x0f785d0, expected: "8885ffd008412891", replacement: "6885ffb008f10b91" },
    ],
  },
  "88564": {
    accountStateGuard: 0x076d4c4,
    accountStateGuardExpected: "c0f24439",
    capabilityGateOne: 0x08041a4,
    capabilityGateOneExpected: "33210036",
    capabilityGateTwo: 0x0817da8,
    capabilityGateTwoExpected: "f6170036",
    accountState: 0x2f951a8,
    accountStateExpected: "fc6fbaa9",
    accountStateNextExpected: "fa6701a9",
    authenticationMethod: 0x076ee24,
    modelTokenFailure: {
      offset: 0x5150948,
      expected: "00000090",
      codeCave: 0x5150b2c,
      codeCaveExpected: "bd0344b2ff8301d1fae701a9f8df02a9f5cf03a9fd7b05a9",
      returnOffset: 0x5150954,
      releaseStub: 0x5c19584,
      // 1.53 enlarged this callback's async frame: the error is now at 0x1d0.
      clearError: "ffea00f9",
    },
    keyVerification: 0x2eee180,
    keyVerificationExpected: "20090036",
    localRequestAuthentication: [
      { offset: 0xf73b9c, expected: "bd0344b2f70f1df8f5cf00a9fd7b02a9f60f00f9fd830091", replacement: "bd0344b2f70f1df8f5cf00a9fd7b02a9f60f00f9fd830091" },
      { offset: 0xf73bb4, expected: "e1020036", replacement: "17000014" },
      { offset: 0xf73c10, expected: "c00640f9140080d2fd7b42a9f5cf40a9f70743f8bdfb439200001fd6", replacement: "c00640f9140080d2fd7b42a9f5cf40a9f70743f8bdfb439200001fd6" },
    ],
    // Keep AuthClientImpl, including independent async subscribers.
    authClientConstructor: { offset: 0x2f7ac70, expected: "b1feff97", replacement: "b1feff97" },
    cliaClosures: [
      { offset: 0xfc1880, expected: "4883ffb008d13391", replacement: "2883ff9008811791" },
      { offset: 0xfc1898, expected: "4883ffb008d13391", replacement: "2883ff9008811791" },
      { offset: 0xfc18b0, expected: "4883ffb008d13391", replacement: "2883ff9008811791" },
    ],
  },
};

const layout = layouts[build];
if (!layout) {
  throw new Error(
    `unsupported Dia build ${build}; account patches are audited only for ${Object.keys(layouts).join(", ")}`,
  );
}
if (layout.anonymousSupported === false && !capabilitiesOnly) {
  throw new Error(`unsupported Dia build ${build} for the anonymous account patch; local capability routing is independently audited`);
}

function branch(from, to, link = false) {
  const delta = to - from;
  if (delta % 4 !== 0 || delta < -(1 << 27) || delta >= 1 << 27) {
    throw new Error("ARM64 account patch branch is out of range");
  }
  const result = Buffer.alloc(4);
  result.writeUInt32LE(((link ? 0x94000000 : 0x14000000) | ((delta / 4) & 0x03ffffff)) >>> 0);
  return result;
}

function dia150TokenPatches(site) {
  const { offset, codeCave, returnOffset, releaseStub } = site;
  const trampoline = Buffer.concat([
    bytes("e00314aa"), // mov x0, x20: release the discarded error.
    branch(codeCave + 4, releaseStub, true),
    bytes(site.clearError ?? "ff5a00f9"), // Clear this build's guarded async error slot.
    bytes("150080d2"), // mov x21, #0
    bytes("1300fcd2"), // mov x19, #empty Swift String tag
    branch(codeCave + 20, returnOffset),
  ]);
  return [
    { scope: "capability", offset, expected: bytes(site.expected),
      replacement: branch(offset, codeCave) },
    { scope: "capability", offset: codeCave,
      expected: site.codeCaveExpected ? bytes(site.codeCaveExpected) : Buffer.alloc(trampoline.length),
      replacement: trampoline },
  ];
}

const patches = [
  ...(layout.localRequestAuthentication ?? []).map(patch => ({ scope: "capability", offset: patch.offset,
    expected: bytes(patch.expected), replacement: bytes(patch.replacement) })),
  ...(layout.anonymousSupported === false ? [] : [{
    scope: "anonymous",
    offset: layout.accountStateGuard,
    expected: bytes(layout.accountStateGuardExpected ?? "c0d24a39"),
    replacement: bytes(layout.accountStateGuardExpected ?? "c0d24a39"),
  }]),
  {
    scope: "capability",
    offset: layout.capabilityGateOne,
    expected: bytes(layout.capabilityGateOneExpected ?? "d31a0036"),
    replacement: nop,
  },
  { scope: "capability", offset: layout.capabilityGateTwo,
    expected: bytes(layout.capabilityGateTwoExpected ?? "d6170036"), replacement: nop },
  ...(layout.anonymousSupported === false ? [] : [{
    scope: "anonymous",
    offset: layout.accountState,
    expected: bytes(layout.accountStateExpected ?? "fa67bba9"),
    replacement: bytes("20008052"),
  }, {
    scope: "anonymous",
    offset: layout.accountState + 4,
    expected: bytes(layout.accountStateNextExpected ?? "f85f01a9"),
    replacement: bytes("c0035fd6"),
  }, {
    scope: "anonymous",
    offset: layout.authenticationMethod,
    expected: bytes("bd0344b2"),
    alternates: [bytes("c10640f9")],
    replacement: bytes("c10640f9"),
  }, {
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
  }, {
    scope: "anonymous",
    offset: layout.authenticationMethod + 8,
    expected: bytes("f5cf00a9"),
    replacement: bytes("140080d2"),
  }, {
    scope: "anonymous",
    offset: layout.authenticationMethod + 12,
    expected: bytes("fd7b02a9"),
    replacement: bytes("20001fd6"),
  }]),
  ...(layout.modelTokenFailure.codeCave
    ? dia150TokenPatches(layout.modelTokenFailure)
    : [{
    scope: "capability",
    // Treat a missing Dia account token as an empty Swift String, releasing
    // the discarded error before the original success continuation runs.
    offset: layout.modelTokenFailure.offset,
    expected: bytes(layout.modelTokenFailure.expected),
    replacement: bytes(layout.modelTokenFailure.replacement),
  }]),
  ...(layout.anonymousSupported === false ? [] : [{
    scope: "anonymous",
    // Older builds use the anonymous dependency. 1.50+ must retain the
    // original constructor, also guarded against the previous crashing patch.
    offset: layout.authClientConstructor.offset,
    expected: bytes(layout.authClientConstructor.expected ?? "a2feff97"),
    replacement: bytes(layout.authClientConstructor.replacement),
  }]),
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
    expected: bytes(layout.keyVerificationExpected ?? "40090036"),
    replacement: nop,
  },
  ...layout.cliaClosures.map((closure) => ({
    scope: "capability",
    // The anonymous dependency's Clia flags use a constant-true closure.
    offset: typeof closure === "number" ? closure : closure.offset,
    expected: bytes(typeof closure === "number" ? layout.cliaExpected : closure.expected),
    replacement: bytes(typeof closure === "number" ? layout.cliaReplacement : closure.replacement),
  })),
];

const selectedPatches = patches.filter((patch) =>
  !capabilitiesOnly && !anonymousOnly ||
  capabilitiesOnly && patch.scope === "capability" ||
  anonymousOnly && patch.scope === "anonymous");
const data = fs.readFileSync(executable);

if (["87864", "88564"].includes(build)) {
  const guards = build === "87864" ? [
    [0x45b360c, "f45a00f917705694940000b4", "token error selector"],
    [0x45b361c, "00f01f9104000014f3d60ba90000009000301991", "token continuations"],
    [0x45b366c, "fd430191d3824ba9d55240f9", "success continuation frame"],
    [0x252fc, "20008052c0035fd6", "constant-true Clia closure"],
    [0x5b4f24c, "708900f010f244f900021fd6", "Swift error release stub"],
  ] : [
    [0x515093c, "f4ea00f913242b94940000b4", "token error selector"],
    [0x515094c, "00b02c9104000014f3d61da90000009000f02591", "token continuations"],
    [0x515099c, "fd430191d3825da9d5e240f9", "success continuation frame"],
    [0x255e0, "20008052c0035fd6", "constant-true Clia closure"],
    [0x5c19584, "d08900b010e241f900021fd6", "Swift error release stub"],
    [0xfc1810, "f44fbea9fd7b01a9fd430091ff8317d1f30308aa", "Clia dependency initializer"],
    [0xfc1888, "e87f08a9280000b0", "first Clia closure storage"],
    [0xfc18a0, "e87f0aa9280000b0", "second Clia closure storage"],
    [0xfc18b8, "e87f0ca9280000b0", "third Clia closure storage"],
  ];
  for (const [offset, expected, label] of guards) {
    if (!data.subarray(offset, offset + expected.length / 2).equals(bytes(expected))) {
      throw new Error(`Dia ${build} ${label} layout changed at 0x${offset.toString(16)}`);
    }
  }
  const token = layout.modelTokenFailure;
  const sign = (value, bits) => value & (1 << (bits - 1)) ? value - 2 ** bits : value;
  for (let offset = 0x3200; offset < (build === "87864" ? 0x5b41638 : 0x5c0bcd0); offset += 4) {
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
      const register = word & 31;
      if (((next & 0xffc00000) >>> 0) === 0x91000000 &&
          ((next >>> 5) & 31) === register) {
        target = (offset & ~4095) + sign(((word >>> 5) & 0x7ffff) * 4 +
          ((word >>> 29) & 3), 21) * 4096 + ((next >>> 10) & 4095);
      }
    }
    if (target !== null && target >= token.codeCave && target < token.codeCave + 24 &&
        !(offset === token.offset && target === token.codeCave)) {
      throw new Error(`Dia ${build} token error continuation gained a reference from 0x${offset.toString(16)}`);
    }
  }
}

if (build === "87561") {
  const same = (offset, hex) => data.subarray(offset, offset + hex.length / 2)
    .equals(bytes(hex));
  const token = layout.modelTokenFailure;
  // This continuation still stores the callback's error in its async frame,
  // then selects error/success solely on x20. The injected trampoline releases
  // that error, clears the frame slot, writes an empty Swift String, and joins
  // the original success continuation. Never use a generic branch skip here.
  for (const [offset, expected, label] of [
    [0x452e850, "f45a00f9a9ff5694940000b4", "token error selector"],
    [0x452e860, "0000299104000014f3d60ba90000009000402291", "token continuations"],
    [0x25830, "20008052c0035fd6", "constant-true Clia closure"],
    [token.codeCave + 24, "00000000", "trampoline alignment padding"],
    [0x5aeeca0, "00021fd6", "last Swift import stub"],
    [0x5aeecc0, "41ae00d0", "first Objective-C import stub"],
  ]) {
    if (!same(offset, expected)) {
      throw new Error(`Dia 87561 ${label} layout changed at 0x${offset.toString(16)}`);
    }
  }
  // The six-word cave is the exact, otherwise unused alignment gap between
  // import-stub sections. Reject any new direct reference into that gap.
  const caveEnd = token.codeCave + 24;
  for (let offset = 0x3200; offset < 0x5add50c; offset += 4) {
    const word = data.readUInt32LE(offset);
    let target = null;
    const signed = (value, bits) => value & (1 << (bits - 1))
      ? value - (1 << bits) : value;
    if (((word & 0x7c000000) >>> 0) === 0x14000000) {
      target = offset + signed(word & 0x03ffffff, 26) * 4;
    } else if (((word & 0xff000010) >>> 0) === 0x54000000 ||
               ((word & 0x7e000000) >>> 0) === 0x34000000) {
      target = offset + signed((word >>> 5) & 0x7ffff, 19) * 4;
    } else if (((word & 0x7e000000) >>> 0) === 0x36000000) {
      target = offset + signed((word >>> 5) & 0x3fff, 14) * 4;
    }
    if (target !== null && target >= token.codeCave && target < caveEnd &&
        !(offset === token.offset && target === token.codeCave)) {
      throw new Error(`Dia 87561 token trampoline gap gained a reference from 0x${offset.toString(16)}`);
    }
  }
}
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
