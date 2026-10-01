#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
enabled_mods="${DIA_CUSTOM_EFFECTIVE_MODS:-$(DIA_CUSTOM_PROFILE="$profile" node "$project_dir/scripts/mods.js" resolved)}"
mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}

node "$project_dir/scripts/check-dia-build.js" "$source_app" --mods "$enabled_mods"
node "$project_dir/src/patches/patch-no-account.js" --check "$source_app"
node "$project_dir/src/patches/patch-dia-import.js" --check "$source_app"
node "$project_dir/src/patches/patch-report-controller.js" --check "$source_app"
node "$project_dir/src/patches/patch-report-upload.js" --check "$source_app"
source_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$source_app/Contents/Info.plist")"
if [[ "$source_build" == 87561 || "$source_build" == 87864 ]]; then
  node "$script_dir/test-account-patch.js" "$source_app"
fi
if mod_enabled developer-tools; then
  node "$project_dir/research/tools/discover-prompt-tools.js" \
    "$source_app/Contents/MacOS/Dia" "$source_build" | \
    /usr/bin/grep -q '"initializerOffset"'
fi
node "$project_dir/research/tools/parse-swift-fields.js" \
  "$source_app/Contents/MacOS/Dia" _artifactUtilities | \
  /usr/bin/grep -q '"name":"_artifactUtilities"'
for patcher in "$project_dir"/src/patches/*.js; do
  node --check "$patcher"
done
node "$project_dir/scripts/test-custom-app-guard.js"
node "$project_dir/scripts/test-runtime-scripts.js"
node "$project_dir/scripts/test-install-transaction.js"
node "$project_dir/scripts/test-browser-process-guard.js"
node "$project_dir/scripts/test-bridge-dependencies.js"
node "$project_dir/scripts/test-prebuilt.js"
node --check "$project_dir/scripts/check-app-target.js"
node --check "$project_dir/scripts/bridge-runtime.js"
node --check "$project_dir/scripts/ensure-bridge-dependencies.js"
node --check "$project_dir/scripts/mods.js"
node --check "$project_dir/scripts/modules.js"
node --check "$project_dir/scripts/check-dia-build.js"
node --check "$project_dir/scripts/compatibility.js"
node --check "$project_dir/scripts/update-policy.js"
node "$project_dir/scripts/test-compatibility.js" "$source_app"
node "$project_dir/scripts/test-agent-handler.js" "$source_app"
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
if /usr/bin/grep -q 'official-dia-sync' \
    "$project_dir/bridge/config/dia-mods.json" || \
   ! /usr/bin/grep -q 'dia_custom_install_dia_import_source_override' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'dia_custom_install_dia_import_presentation_override' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'return @"Import from Dia"' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'return @"Importing from Dia"' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'dia_custom_arc_import_original_name(object, selector)' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'patch-dia-import.js' \
    "$project_dir/scripts/install.sh"; then
  print -u2 "Official Dia migration boundary is incomplete"
  exit 1
fi
print "ok    Official Dia migration uses the native importer without Sync access"
node "$project_dir/scripts/test-dia-import.js"
node "$project_dir/scripts/test-profile-integrity.js"
if ! /usr/bin/grep -q 'snapshot-profile.sh' "$project_dir/scripts/build.sh" || \
   ! /usr/bin/grep -q 'preflight-profile.sh' "$project_dir/scripts/build.sh" || \
   ! /usr/bin/grep -q 'snapshot-profile.sh' "$project_dir/scripts/refresh-install.sh" || \
   ! /usr/bin/grep -q 'latest-install-transaction.json' "$project_dir/scripts/build.sh"; then
  print -u2 "install/update profile transaction guard is incomplete"
  exit 1
fi
print "ok    install/update paths snapshot and preflight the complete browser profile"
node "$project_dir/scripts/test-profile-consolidation.js"
zsh -n "$project_dir/dia-custom" "$project_dir"/scripts/*.sh
"$script_dir/build-bootstrap.sh" "$source_app" >/dev/null
startup_test_dir="$project_dir/.build/bootstrap"
xcrun clang -c -Os -x objective-c -fblocks \
  -I "$startup_test_dir" "$script_dir/test-ui-startup.m" \
  -o "$startup_test_dir/test-ui-startup.o"
xcrun swiftc -parse-as-library -O "$project_dir/src/bootstrap/offline-bootstrap-introspection.swift" \
  "$startup_test_dir/test-ui-startup.o" \
  "$startup_test_dir/offline-bootstrap-arm64.o" \
  -framework Foundation -framework AppKit -framework WebKit \
  -o "$startup_test_dir/test-ui-startup"
"$startup_test_dir/test-ui-startup"
/bin/zsh "$script_dir/test-advanced-chat.sh"
if ! /usr/bin/grep -q 'dia_custom_prepare_self_contained_runtime' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'dia_custom_schedule_window_menu_repair' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q "CFBundleURLTypes:0:CFBundleURLName" \
    "$project_dir/scripts/build.sh" || \
   /usr/bin/grep -q 'Delete :CFBundleURLTypes' \
    "$project_dir/scripts/build.sh" || \
   ! /usr/bin/grep -q -- '--disable-sync' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q -- '--host-resolver-rules=' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'DIA_CUSTOM_MODEL_CATALOG_PATH' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'DIA_CUSTOM_STATE_DIR' \
    "$project_dir/bridge/src/paths.js" || \
   ! /usr/bin/grep -q 'bundle-runtime.sh' \
    "$project_dir/scripts/install.sh"; then
  print -u2 "double-click self-contained runtime is incomplete"
  exit 1
fi
print "ok    app bundle owns launch policy, external URL routing, and native window commands"
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
if ! /usr/bin/grep -q '15 \* NSEC_PER_SEC' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q '"openOrGenerateCliaReport"' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   ! /usr/bin/grep -q 'performSelector:scheduleSelector' \
    "$project_dir/src/bootstrap/offline-bootstrap.c" || \
   /usr/bin/grep -q 'dia_custom_fetch_local_memory_state(target, action, !found)' \
    "$project_dir/src/bootstrap/offline-bootstrap.c"; then
  print -u2 "native Morning Brief fallback or event-driven Memory refresh is incomplete"
  exit 1
fi
print "ok    Morning Brief uses the guarded native action and Memory avoids frame polling"

node "$project_dir/scripts/compatibility.js" "$source_app" \
  --mods "$enabled_mods" --json | node -e '
    let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
      const v=JSON.parse(s);
      if(!v.compatible||v.perMod.length===0) process.exit(1);
    })'
print "ok    every enabled Dia Mod has a compatibility result"

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
