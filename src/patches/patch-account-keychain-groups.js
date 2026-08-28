#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const positional = args.filter((value) => !value.startsWith("--"));
const appPath = positional[0] ? path.resolve(positional[0]) : "";
const teamID = positional[1] ?? "";
if ((!checkOnly &&
  path.basename(path.dirname(appPath)) !== "work" ||
  !checkOnly && !path.basename(appPath).startsWith("Dia Custom")) ||
  !/^[A-Z0-9]{10}$/.test(teamID)
) {
  throw new Error("usage: patch-account-keychain-groups.js <Dia Custom.app> <10-character Team ID>");
}

const officialAuth = "S6N382Y83G.company.thebrowser.browser.auth";
const officialWebAuthn = "S6N382Y83G.company.thebrowser.browser.webauthn";
const customAuth = `${teamID}.local.rttm.dia.account.auth.v01`;
const customWebAuthn = `${teamID}.local.rttm.dia.account.webauthn.v01`;
if (customAuth.length !== officialAuth.length ||
    customWebAuthn.length !== officialWebAuthn.length) {
  throw new Error("custom Keychain access groups must preserve Mach-O string lengths");
}

function replaceExact(binaryPath, source, replacement, expectedCount) {
  const data = fs.readFileSync(binaryPath);
  const sourceBytes = Buffer.from(source);
  const replacementBytes = Buffer.from(replacement);
  const sourceOffsets = [];
  const replacementOffsets = [];
  for (let offset = data.indexOf(sourceBytes); offset >= 0;
    offset = data.indexOf(sourceBytes, offset + sourceBytes.length)) {
    sourceOffsets.push(offset);
  }
  for (let offset = data.indexOf(replacementBytes); offset >= 0;
    offset = data.indexOf(replacementBytes, offset + replacementBytes.length)) {
    replacementOffsets.push(offset);
  }
  const sources = sourceOffsets.length;
  const replacements = replacementOffsets.length;
  if (sources === 0 && replacements === expectedCount) return;
  if (sources !== expectedCount || replacements !== 0) {
    throw new Error(
      `unexpected Keychain group layout in ${binaryPath}: ` +
      `${sources} source and ${replacements} replacement strings`,
    );
  }
  for (const offset of sourceOffsets) replacementBytes.copy(data, offset);
  if (!checkOnly) fs.writeFileSync(binaryPath, data);
}

const mainExecutable = path.join(appPath, "Contents/MacOS/Dia");
const arcCore = path.join(
  appPath,
  "Contents/Frameworks/ArcCore.framework/Versions/A/ArcCore",
);
replaceExact(mainExecutable, officialAuth, customAuth, 3);
replaceExact(mainExecutable, officialWebAuthn, customWebAuthn, 3);
replaceExact(arcCore, officialWebAuthn, customWebAuthn, 2);
console.log(`${checkOnly ? "Validated" : "Isolated"} Dia account and WebAuthn Keychain groups for Team ${teamID}`);
