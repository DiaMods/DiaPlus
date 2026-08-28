#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
enabled_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$project_dir/scripts/mods.js" resolved)"

node "$project_dir/scripts/check-dia-build.js" "$source_app" --mods "$enabled_mods"
node "$project_dir/src/patches/patch-no-account.js" --check "$source_app"
signing_details="$("$project_dir/scripts/signing-identity.sh")"
signing_remainder="${signing_details#*$'\t'}"
sync_test_team_id="${signing_remainder%%$'\t'*}"
node "$project_dir/src/patches/patch-account-keychain-groups.js" \
  --check "$source_app" "$sync_test_team_id"
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
/usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES node "$project_dir/scripts/mods.js" \
  enable official-dia-sync --profile "$mod_test_profile" >/dev/null
sync_mods="$(/usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES \
  node "$project_dir/scripts/mods.js" resolved --profile "$mod_test_profile")"
if [[ ",$sync_mods," != *",official-dia-sync,"* ||
      ",$sync_mods," == *",account-bypass,"* ]]; then
  print -u2 "Official Sync did not atomically replace anonymous account mode"
  exit 1
fi
/usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES node "$project_dir/scripts/mods.js" \
  disable official-dia-sync --profile "$mod_test_profile" >/dev/null
restored_mods="$(/usr/bin/env -u DIA_CUSTOM_MODS -u DIA_CUSTOM_MODULES \
  node "$project_dir/scripts/mods.js" resolved --profile "$mod_test_profile")"
if [[ ",$restored_mods," != *",account-bypass,"* ||
      ",$restored_mods," == *",official-dia-sync,"* ]]; then
  print -u2 "Disabling Official Sync did not restore anonymous account mode"
  exit 1
fi
/bin/rm -rf "$mod_test_profile"
trap - EXIT
print "ok    Dia Mods are independently gated and required safety mods fail closed"
if ! /usr/bin/grep -q 'DiaCustomModsPaneContext' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'mod-manager-window-context-cleared' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   /usr/bin/grep -q 'static NSTextField \*dia_custom_mods_toolbar_title' \
    "$project_dir/src/bootstrap/offline-bootstrap.c"; then
  print -u2 "Mod Manager still retains Settings-window UI in global pointers"
  exit 1
fi
print "ok    Mod Manager Settings state is scoped to each live window"
if ! /usr/bin/grep -q 'official-dia-sync' \
    "$project_dir/bridge/config/dia-mods.json" || \
   ! /usr/bin/grep -q 'official-sync-blocked-custom-client-marker' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'lastSuccessfulServiceResponse' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'sync-encryption-enabled=true' \
    "$project_dir/scripts/launch.sh"; then
  print -u2 "Official Dia Sync safety boundary is incomplete"
  exit 1
fi
print "ok    Official Dia Sync is separately gated and encryption-required"
zsh -n "$project_dir/dia-custom" "$project_dir"/scripts/*.sh
"$script_dir/build-bootstrap.sh" "$source_app" >/dev/null
if ! /usr/bin/grep -q 'onEnableMorningBriefTapped' \
    "$project_dir/src/bootstrap/offline-bootstrap.c"; then
  print -u2 "native Morning Brief confirmation action is not wired"
  exit 1
fi
if /usr/bin/grep -q 'Enabling the Morning Brief for %@' \
    "$project_dir/src/bootstrap/offline-bootstrap.c"; then
  print -u2 "Morning Brief confirmation was replaced by custom UI"
  exit 1
fi
print "ok    Morning Brief switching preserves Dia's native confirmation UI"

if ! /usr/bin/grep -q 'dia_custom_swift_enable_advanced_new_tab_surface' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'showParticlesLogo' \
    "$project_dir/src/bootstrap/offline-bootstrap-introspection.swift"; then
  print -u2 "native Advanced Chat New Tab state is not wired"
  exit 1
fi
print "ok    Advanced Chat uses Dia's native particle New Tab surface"

if "$script_dir/build-apple-model-helper.sh" >/dev/null; then
  print "ok    Apple Foundation Models helper builds"
else
  print "warn  Apple Foundation Models helper is unavailable"
fi

(cd "$project_dir/bridge" && npm run check && npm test)
print "\nDia Custom source checks passed."
