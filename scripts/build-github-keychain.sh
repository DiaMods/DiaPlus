#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
project_dir="${script_dir:h}"
prebuilt="$(node "$script_dir/prebuilt.js" github-keychain)"
if [[ -n "$prebuilt" ]]; then
  print "$prebuilt"
  exit 0
fi
output="$project_dir/.build/github-keychain/DiaCustomGitHubKeychain"
mkdir -p "${output:h}"
xcrun swiftc -O -target arm64-apple-macos14.0 "$project_dir/src/updater/github-keychain.swift" -o "$output"
codesign --force --sign - --identifier local.rttm.dia.updater.keychain "$output"
print "$output"
