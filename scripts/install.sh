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

bootstrap="$($script_dir/build-bootstrap.sh)"
node "$project_dir/src/patches/patch-keychain-label.js" "$app"
node "$project_dir/src/patches/patch-endpoint.js" "$app"
node "$project_dir/src/patches/patch-no-account.js" "$app"
node "$project_dir/src/patches/embed-bootstrap.js" "$app" "$bootstrap"
node "$project_dir/src/patches/patch-agent-handler.js" "$app"

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
