#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
app="${1:-}"
node_version="v24.20.0"
node_archive="node-${node_version}-darwin-arm64.tar.gz"
node_sha256="40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8"
runtime_dir="$project_dir/.build/runtime"
archive_path="$runtime_dir/$node_archive"
extracted_dir="$runtime_dir/node-${node_version}-darwin-arm64"

if [[ -z "$app" || ! -d "$app" ]]; then
  print -u2 "usage: bundle-runtime.sh /path/to/Dia Custom.app"
  exit 2
fi

mkdir -p "$runtime_dir"
if [[ ! -f "$archive_path" ]]; then
  /usr/bin/curl --fail --location --show-error \
    "https://nodejs.org/dist/$node_version/$node_archive" \
    --output "$archive_path"
fi
actual_sha256="$(/usr/bin/shasum -a 256 "$archive_path" | /usr/bin/awk '{print $1}')"
if [[ "$actual_sha256" != "$node_sha256" ]]; then
  print -u2 "Bundled Node archive checksum mismatch."
  exit 1
fi
if [[ ! -x "$extracted_dir/bin/node" ]]; then
  /usr/bin/tar -xzf "$archive_path" -C "$runtime_dir"
fi
if [[ ! -d "$project_dir/bridge/node_modules/@openai/codex-sdk" ]]; then
  (cd "$project_dir/bridge" && npm ci --omit=dev)
fi

node_target="$app/Contents/Helpers/DiaCustomNode"
bridge_target="$app/Contents/Resources/DiaCustomBridge"
mkdir -p "${node_target:h}" "$bridge_target"
/usr/bin/ditto "$extracted_dir/bin/node" "$node_target"
/bin/chmod 755 "$node_target"
/usr/bin/rsync -a --delete \
  --exclude .state \
  --exclude test \
  --exclude '*.log' \
  "$project_dir/bridge/" "$bridge_target/"

runtime_id="$(
  find "$project_dir/bridge/src" "$project_dir/bridge/config" \
    "$project_dir/bridge/package.json" "$project_dir/bridge/package-lock.json" \
    -type f -print0 | /usr/bin/sort -z | \
    /usr/bin/xargs -0 /usr/bin/shasum -a 256 | \
    /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
)"
info="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :DiaCustomBridgeRuntimeID string '$runtime_id'" \
  "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :DiaCustomBridgeRuntimeID '$runtime_id'" "$info"

"$node_target" -e 'import("node:sqlite")' >/dev/null
print "Bundled the local AI bridge and Node $node_version inside $app"
