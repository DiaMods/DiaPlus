#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
app="${1:-${DIA_CUSTOM_APP:-$work_dir/Dia Custom RTTM.app}}"

if [[ ! -d "$app" ]]; then
  print -u2 "Dia Custom is not installed at $app. Run './dia-custom build' first."
  exit 1
fi
if /usr/bin/pgrep -f "$app/Contents/MacOS/Dia" >/dev/null; then
  print -u2 "Quit Dia Custom before updating its patched executables."
  exit 1
fi

# Sparkle runs in a helper process, outside the injected NSURLSession hook.
# Disable it in the clone itself and point any manual check at an empty local
# appcast served by the bridge. Official Dia remains free to update normally.
info="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :SUEnableAutomaticChecks false" "$info"
/usr/libexec/PlistBuddy -c "Set :SUAutomaticallyUpdate false" "$info"
/usr/libexec/PlistBuddy -c "Set :SUScheduledCheckInterval 0" "$info"
/usr/libexec/PlistBuddy -c "Set :SUFeedURL http://127.0.0.1:8765/updates-disabled.xml" "$info"

bootstrap="$($script_dir/build-bootstrap.sh "$app")"
node "$project_dir/src/patches/patch-keychain-label.js" "$app"
node "$project_dir/src/patches/patch-endpoint.js" "$app"
node "$project_dir/src/patches/patch-no-account.js" "$app"
node "$project_dir/src/patches/embed-bootstrap.js" "$app" "$bootstrap"
node "$project_dir/src/patches/patch-agent-handler.js" "$app"
node "$project_dir/src/patches/patch-report-controller.js" "$app"
node "$project_dir/src/patches/patch-report-upload.js" "$app"

# Apple Foundation Models are optional at runtime, but when the current SDK is
# installed we embed a small signed helper in the clone. Keeping this outside
# Dia's executable makes the provider independent of Dia's private ABI.
apple_helper_target="$app/Contents/Helpers/DiaCustomAppleModel"
if apple_helper="$($script_dir/build-apple-model-helper.sh)"; then
  mkdir -p "${apple_helper_target:h}"
  /usr/bin/ditto "$apple_helper" "$apple_helper_target"
  /bin/chmod 755 "$apple_helper_target"
else
  print -u2 "Apple Foundation Models helper was not built; other providers remain available."
fi

# Sign the modified nested executable first, then seal the complete clone.
codesign --force --sign - \
  --entitlements "$project_dir/src/config/agent-runtime-entitlements.plist" \
  "$app/Contents/Resources/agent-server-resources/dist/handler"
codesign --force --deep --sign - \
  --entitlements "$project_dir/src/config/clone-entitlements.plist" \
  "$app"
codesign --verify --strict \
  "$app/Contents/Resources/agent-server-resources/dist/handler"
codesign --verify --deep --strict "$app"

print "Installed and signed Dia Custom patches in $app"
