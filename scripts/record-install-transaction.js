#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [outputArgument, installedAppArgument, backupAppArgument,
  profileArgument, profileSnapshotArgument] = process.argv.slice(2);
if (!outputArgument || !installedAppArgument || !profileArgument) {
  throw new Error(
    "usage: record-install-transaction.js OUTPUT INSTALLED_APP BACKUP_APP PROFILE PROFILE_SNAPSHOT",
  );
}

const output = resolve(outputArgument);
const value = {
  backupApp: backupAppArgument ? resolve(backupAppArgument) : null,
  createdAt: new Date().toISOString(),
  installedApp: resolve(installedAppArgument),
  profile: resolve(profileArgument),
  profileSnapshot: profileSnapshotArgument ? resolve(profileSnapshotArgument) : null,
  version: 1,
};

await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
await chmod(output, 0o600);
