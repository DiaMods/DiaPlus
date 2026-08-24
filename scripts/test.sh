#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
enabled_modules="$(DIA_CUSTOM_PROFILE="$profile" node "$project_dir/scripts/modules.js" resolved)"

node "$project_dir/scripts/check-dia-build.js" "$source_app" --modules "$enabled_modules"
node "$project_dir/src/patches/patch-no-account.js" --check "$source_app"
node "$project_dir/src/patches/patch-report-controller.js" --check "$source_app"
node "$project_dir/src/patches/patch-report-upload.js" --check "$source_app"
source_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$source_app/Contents/Info.plist")"
node "$project_dir/research/tools/discover-prompt-tools.js" \
  "$source_app/Contents/MacOS/Dia" "$source_build" | \
  /usr/bin/grep -q '"initializerOffset"'
node "$project_dir/research/tools/parse-swift-fields.js" \
  "$source_app/Contents/MacOS/Dia" _artifactUtilities | \
  /usr/bin/grep -q '"name":"_artifactUtilities"'
for patcher in "$project_dir"/src/patches/*.js; do
  node --check "$patcher"
done
node --check "$project_dir/scripts/modules.js"
node --check "$project_dir/scripts/check-dia-build.js"
module_test_profile="$(/usr/bin/mktemp -d -t dia-custom-modules)"
trap '/bin/rm -rf "$module_test_profile"' EXIT
/usr/bin/env -u DIA_CUSTOM_MODULES node "$project_dir/scripts/modules.js" \
  disable model-picker --profile "$module_test_profile" >/dev/null
if /usr/bin/env -u DIA_CUSTOM_MODULES node "$project_dir/scripts/modules.js" \
    resolved --profile "$module_test_profile" | /usr/bin/grep -q 'model-picker'; then
  print -u2 "model-picker remained enabled in the isolated module test"
  exit 1
fi
if /usr/bin/env -u DIA_CUSTOM_MODULES node "$project_dir/scripts/modules.js" \
    disable network-isolation --profile "$module_test_profile" >/dev/null 2>&1; then
  print -u2 "required network-isolation module was incorrectly disableable"
  exit 1
fi
/bin/rm -rf "$module_test_profile"
trap - EXIT
print "ok    compatibility modules are independently gated and required safety modules fail closed"
zsh -n "$project_dir/dia-custom" "$project_dir"/scripts/*.sh
"$script_dir/build-bootstrap.sh" "$source_app" >/dev/null

if "$script_dir/build-apple-model-helper.sh" >/dev/null; then
  print "ok    Apple Foundation Models helper builds"
else
  print "warn  Apple Foundation Models helper is unavailable"
fi

(cd "$project_dir/bridge" && npm run check && npm test)
print "\nDia Custom source checks passed."
