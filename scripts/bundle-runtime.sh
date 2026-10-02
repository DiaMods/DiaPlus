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
node "$script_dir/ensure-bridge-dependencies.js" "$project_dir/bridge"

node_target="$app/Contents/Helpers/DiaCustomNode"
bridge_target="$app/Contents/Resources/DiaCustomBridge"
mkdir -p "${node_target:h}" "$bridge_target"
/usr/bin/ditto "$extracted_dir/bin/node" "$node_target"
/bin/chmod 755 "$node_target"
github_helper="$(/bin/zsh "$script_dir/build-github-keychain.sh")"
/usr/bin/ditto "$github_helper" "$app/Contents/Helpers/DiaCustomGitHubKeychain"
/usr/bin/rsync -a --delete \
  --exclude .state \
  --exclude test \
  --exclude bin \
  --exclude '*.log' \
  "$project_dir/bridge/" "$bridge_target/"

# Carry the exact mod sources and pinned build runtime with the installed app.
# The bridge itself is materialized from DiaCustomBridge when preparing an update.
updater_target="$app/Contents/Resources/DiaCustomUpdater"
mkdir -p "$updater_target/runtime"
for source_dir in scripts src research/tools; do
  mkdir -p "$updater_target/$source_dir"
  /usr/bin/rsync -a --delete "$project_dir/$source_dir/" "$updater_target/$source_dir/"
done
if [[ -d "$project_dir/prebuilt" ]]; then
  /usr/bin/rsync -a --delete "$project_dir/prebuilt/" "$updater_target/prebuilt/"
fi
/usr/bin/ditto "$project_dir/dia-custom" "$updater_target/dia-custom"
/usr/bin/ditto "$archive_path" "$updater_target/runtime/$node_archive"

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
if [[ -f "$project_dir/src/config/mod-release.json" ]]; then
  for release_key in version installerVersion protocolVersion; do
    case "$release_key" in
      version) plist_key=DiaCustomModVersion ;;
      installerVersion) plist_key=DiaCustomInstallerVersion ;;
      protocolVersion) plist_key=DiaCustomUpdateProtocol ;;
    esac
    release_value="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]))[process.argv[2]])' "$project_dir/src/config/mod-release.json" "$release_key")"
    /usr/libexec/PlistBuddy -c "Add :$plist_key string '$release_value'" "$info" 2>/dev/null || \
      /usr/libexec/PlistBuddy -c "Set :$plist_key '$release_value'" "$info"
  done
fi

"$node_target" -e 'import("node:sqlite")' >/dev/null
print "Bundled the local AI bridge and Node $node_version inside $app"
