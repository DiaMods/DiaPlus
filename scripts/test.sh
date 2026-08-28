#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
enabled_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$project_dir/scripts/mods.js" resolved)"

node "$project_dir/scripts/check-dia-build.js" "$source_app" --mods "$enabled_mods"
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
node --check "$project_dir/scripts/mods.js"
node --check "$project_dir/scripts/modules.js"
node --check "$project_dir/scripts/check-dia-build.js"
mod_test_profile="$(/usr/bin/mktemp -d -t dia-custom-mods)"
trap '/bin/rm -rf "$mod_test_profile"' EXIT
/usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES node "$project_dir/scripts/mods.js" \
  disable model-picker --profile "$mod_test_profile" >/dev/null
if /usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES node "$project_dir/scripts/mods.js" \
    resolved --profile "$mod_test_profile" | /usr/bin/grep -q 'model-picker'; then
  print -u2 "model-picker remained enabled in the isolated Dia Mod test"
  exit 1
fi
if /usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES node "$project_dir/scripts/mods.js" \
    disable network-isolation --profile "$mod_test_profile" >/dev/null 2>&1; then
  print -u2 "required network-isolation mod was incorrectly disableable"
  exit 1
fi
/bin/rm -rf "$mod_test_profile"
trap - EXIT
print "ok    Dia Mods are independently gated and required safety mods fail closed"
zsh -n "$project_dir/dia-custom" "$project_dir"/scripts/*.sh
"$script_dir/build-bootstrap.sh" "$source_app" >/dev/null

if "$script_dir/build-apple-model-helper.sh" >/dev/null; then
  print "ok    Apple Foundation Models helper builds"
else
  print "warn  Apple Foundation Models helper is unavailable"
fi

(cd "$project_dir/bridge" && npm run check && npm test)
print "\nDia Custom source checks passed."
