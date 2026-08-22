#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const argumentsAfterScript = process.argv.slice(2);
const appArgument = argumentsAfterScript.find((argument) => !argument.startsWith("--"));
const appPath = appArgument ? path.resolve(appArgument) : "";
const executable = path.join(appPath, "Contents", "MacOS", "Dia");

if (
  path.basename(path.dirname(appPath)) !== "work" ||
  !path.basename(appPath).startsWith("Dia Custom")
) {
  throw new Error(`refusing to patch a non-clone executable: ${executable}`);
}

const data = fs.readFileSync(executable);
const nop = Buffer.from("1f2003d5", "hex");
const patches = [
  {
    offset: 0x075588c,
    expected: Buffer.from("c0d24a39", "hex"),
    replacement: Buffer.from("c0d24a39", "hex"),
  },
  { offset: 0x07cf6b8, expected: Buffer.from("d31a0036", "hex"), replacement: nop },
  { offset: 0x07e24b4, expected: Buffer.from("d6170036", "hex"), replacement: nop },
  {
    offset: 0x2c6c5e8,
    expected: Buffer.from("fa67bba9", "hex"),
    replacement: Buffer.from("20008052", "hex"),
  },
  {
    offset: 0x2c6c5ec,
    expected: Buffer.from("f85f01a9", "hex"),
    replacement: Buffer.from("c0035fd6", "hex"),
  },
  {
    offset: 0x0756908,
    expected: Buffer.from("bd0344b2", "hex"),
    alternates: [Buffer.from("c10640f9", "hex")],
    replacement: Buffer.from("c10640f9", "hex"),
  },
  {
    offset: 0x075690c,
    expected: Buffer.from("ffc300d1", "hex"),
    alternates: [
      Buffer.from("00008052", "hex"),
      Buffer.from("20008052", "hex"),
      Buffer.from("40008052", "hex"),
      Buffer.from("60008052", "hex"),
    ],
    // AuthenticationMethod is a three-case Swift enum:
    //   0 = signUp, 1 = signIn, 2 = restored.
    // Returning signUp was the reason every launch re-entered onboarding.
    replacement: Buffer.from("40008052", "hex"),
  },
  {
    offset: 0x0756910,
    expected: Buffer.from("f5cf00a9", "hex"),
    replacement: Buffer.from("140080d2", "hex"),
  },
  {
    offset: 0x0756914,
    expected: Buffer.from("fd7b02a9", "hex"),
    replacement: Buffer.from("20001fd6", "hex"),
  },
  {
    // ModelRegistryClientImpl.makeRequest(url:) normally abandons the request
    // when the account token provider throws. Dia Custom talks only to its
    // localhost bridge, so turn that one failure into an empty Swift String.
    // Release and clear the discarded Swift error before falling through to
    // the original success continuation, which builds "Bearer " and proceeds.
    offset: 0x3fec870,
    expected: Buffer.from(
      "e05240f91d3c5694000000900030299104000014",
      "hex",
    ),
    replacement: Buffer.from(
      "e00314aa7d3c5694ff5a00f9150080d21300fcd2",
      "hex",
    ),
  },
  {
    // The app composition root normally turns AuthClientImpl (the real Dia
    // account client) into the AuthClient dependency used throughout chat.
    // Redirect just that constructor call to Dia's ordinary anonymous
    // dependency fallback. This keeps the custom browser account-free and
    // avoids reading, copying, or refreshing a real Dia credential.
    offset: 0x2c534ac,
    expected: Buffer.from("a2feff97", "hex"),
    replacement: Buffer.from("22a78c97", "hex"),
  },
  {
    // Keep AuthClient's anonymous fallback intact. An earlier diagnostic
    // temporarily copied Dia's UI-test AuthClient here, which exposed the
    // synthetic "Stub Name" / diauitest@thebrowser.company identity in
    // Settings. Restore the original prologue and construction path; the
    // targeted Clia closures below enable New Chat without inventing a user.
    offset: 0x0f7d134,
    expected: Buffer.from(
      "f44fbea9fd7b01a9fd430091ff0313d1f30308aaa8fffff008712991e87f02a9" +
        "683802b008411c91e87f03a9a8fffff008f12c91e87f04a9e0830091e1230091" +
        "22008052",
      "hex",
    ),
    alternates: [Buffer.from(
      "f44fbea9fd7b01a9fd430091f30308aabeffff97e10300aae00313aa024a8052" +
        "96f717954885ffb008311291687e06a9687e08a9687e0ba9fd7b41a9f44fc2a8" +
        "c0035fd6",
      "hex",
    )],
    replacement: Buffer.from(
      "f44fbea9fd7b01a9fd430091ff0313d1f30308aaa8fffff008712991e87f02a9" +
        "683802b008411c91e87f03a9a8fffff008f12c91e87f04a9e0830091e1230091" +
        "22008052",
      "hex",
    ),
  },
  {
    // Production Dia verifies the server's ephemeral P-256 key against a
    // production-only long-term signing key. Dia Custom redirects AI traffic
    // to localhost, so that trust anchor cannot authenticate the local bridge.
    // local bridge. Keep all parsing and ECDH intact, but accept the bridge's
    // well-formed ephemeral key after its DER signature has been parsed.
    offset: 0x2a0604c,
    expected: Buffer.from("40090036", "hex"),
    replacement: nop,
  },
  {
    // Dia's anonymous fallback normally reports Clia/New Chat as disabled.
    // Point its cliaEnabled closure at an existing constant-true closure while
    // leaving every production AuthClient implementation untouched.
    offset: 0x0f7d1c8,
    expected: Buffer.from("6885ffd008912991", "hex"),
    replacement: Buffer.from("4885ffb008311291", "hex"),
  },
  {
    // Match canEnableClia to the local New Chat state.
    offset: 0x0f7d1e0,
    expected: Buffer.from("6885ffd008912991", "hex"),
    replacement: Buffer.from("4885ffb008311291", "hex"),
  },
  {
    // Mark the anonymous local session as having activated New Chat already so
    // account-backed onboarding is not required.
    offset: 0x0f7d204,
    expected: Buffer.from("6885ffd008912991", "hex"),
    replacement: Buffer.from("4885ffb008311291", "hex"),
  },
];

for (const patch of patches) {
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
      `unexpected instruction at 0x${patch.offset.toString(16)}: ${current.toString("hex")}`,
    );
  }
  patch.replacement.copy(data, patch.offset);
}

fs.writeFileSync(executable, data);
console.log(`Disabled the Dia-account gate and selected restored launch state in ${executable}`);
