#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${DIA_CUSTOM_WORK_DIR:-${project_dir:h}}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
clone_app="${DIA_CUSTOM_APP:-/Applications/Dia+.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
# A downloaded toolkit can be invoked by an older client whose environment
# points at the running browser's stores. Rebase every mutable bridge path
# before any helper imports paths.js or resolves configuration.
if [[ "${DIA_CUSTOM_STAGING:-0}" == "1" ]]; then
  unset DIA_CUSTOM_CONFIG_PATH DIA_CUSTOM_MODEL_CATALOG_PATH \
    DIA_CUSTOM_CREDENTIALS_PATH DIA_CUSTOM_APPS_STATE_PATH DIA_CUSTOM_MEMORY_PATH \
    DIA_CUSTOM_MODS_STATE_PATH DIA_CUSTOM_COMPATIBILITY_PATH \
    DIA_CUSTOM_TOOL_CACHE_DIR DIA_CUSTOM_CONNECTOR_MANIFESTS \
    DIA_CUSTOM_DECISION_WORKSPACE DIA_CUSTOM_TOOL_COVERAGE_PATH \
    DIA_CUSTOM_CAPTURE_DIR DIA_CUSTOM_HISTORY_PATH DIA_CUSTOM_RUNTIME_LOG \
    DIA_CUSTOM_NETWORK_LOG DIA_CUSTOM_MODS_MANIFEST_PATH
  export DIA_CUSTOM_STATE_DIR="$profile/Bridge/.state"
fi
bundle_id="local.rttm.dia"
replace=false
install_stamp="$(/bin/date +%Y%m%d-%H%M%S).$$"

if [[ "${1:-}" == "--replace" ]]; then
  replace=true
  shift
fi
if (( $# != 0 )); then
  print -u2 "usage: ./dia-custom build [--replace]"
  exit 2
fi
if [[ ! -d "$source_app" ]]; then
  print -u2 "Dia is not installed at $source_app"
  exit 1
fi
node "$script_dir/check-app-target.js" build "$source_app" "$clone_app"

requested_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
enabled_mods="${DIA_CUSTOM_EFFECTIVE_MODS:-$requested_mods}"
mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}
node "$script_dir/check-dia-build.js" "$source_app" --mods "$enabled_mods" --allow-structural
compatibility_report="$(/usr/bin/mktemp -t dia-custom-build-compatibility)"
temporary_app="${clone_app:h}/Dia Custom RTTM.build.$install_stamp.app"
backup_app="${clone_app:h}/.dia-custom-backups/Dia Custom RTTM.pre-rebuild.$install_stamp.app"
failed_app="${clone_app:h}/.dia-custom-backups/Dia Custom RTTM.failed-rebuild.$install_stamp.app"
source "$script_dir/install-transaction.sh"
transaction_begin "$clone_app" "$temporary_app" "$backup_app" "$failed_app" "$profile"
cleanup_build() {
  local result=$?
  transaction_cleanup || result=$?
  /bin/rm -f "$compatibility_report"
  return "$result"
}
trap cleanup_build EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$script_dir/compatibility.js" "$source_app" \
  --mods "$requested_mods" --json > "$compatibility_report"

if [[ -e "$clone_app" && "$replace" != true ]]; then
  print -u2 "Dia Custom already exists at $clone_app"
  print -u2 "Use './dia-custom install' to refresh it, or 'build --replace' for a fresh clone."
  exit 1
fi
node "$script_dir/browser-process-guard.js" assert-stopped "$clone_app" "$profile"

# A force-quit browser can leave its self-contained Node bridge orphaned. Stop
# only a process whose complete command is the exact clone's bundled
# DiaCustomNode invocation; never kill an unrelated localhost app.
node "$script_dir/bridge-runtime.js" stop "$clone_app"

profile_snapshot=""
if [[ -f "$profile/User Data/Local State" ]]; then
  profile_snapshot="$(DIA_CUSTOM_APP="$clone_app" \
    "$script_dir/snapshot-profile.sh" "$profile" "$work_dir/backups/profiles" \
      "pre-rebuild.$install_stamp")"
  print "Browser profile preserved at $profile_snapshot"
fi

mkdir -p "$work_dir" "${profile:h}" "${clone_app:h}"
/usr/bin/ditto "$source_app" "$temporary_app"

info="$temporary_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$info"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Dia+'" "$info"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 'Dia+'" "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Dia+'" "$info"
# Keep the standard web URL declarations under the clone's distinct bundle ID.
# Removing these made Launch Services and external automation unable to route a
# requested background tab to Dia Custom, even though its AppleScript tab API
# and Chromium controller were healthy.
/usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleURLName 'Dia Custom Website URL'" "$info"
/usr/libexec/PlistBuddy -c "Delete :CFBundleDocumentTypes" "$info" 2>/dev/null || true

DIA_CUSTOM_PROFILE="$profile" DIA_CUSTOM_MODS="$enabled_mods" \
  DIA_CUSTOM_EFFECTIVE_MODS="$enabled_mods" \
  DIA_CUSTOM_SKIP_PROFILE_SNAPSHOT=1 DIA_CUSTOM_STAGING=1 \
  "$script_dir/install.sh" "$temporary_app"
"$script_dir/verify-staged.sh" "$temporary_app" "$enabled_mods"
if [[ -n "$profile_snapshot" ]]; then
  "$script_dir/preflight-profile.sh" "$temporary_app" "$profile_snapshot"
fi

transaction_capture_state || exit $?
transaction_swap || exit $?
"$script_dir/verify-staged.sh" "$clone_app" "$enabled_mods"

tx_state_started=true
mkdir -p "$profile/Bridge/.state"
/bin/chmod 700 "$profile/Bridge/.state"
transaction_file="$work_dir/backups/transactions/Dia Custom RTTM.pre-rebuild.$install_stamp.json"
recorded_backup=""
[[ "$tx_preserved" != true ]] || recorded_backup="$backup_app"
node "$script_dir/record-install-transaction.js" "$transaction_file" \
  "$clone_app" "$recorded_backup" "$profile" "$profile_snapshot"
/bin/cp "$transaction_file" "$profile/Bridge/.state/latest-install-transaction.json"
/bin/chmod 600 "$profile/Bridge/.state/latest-install-transaction.json"
print "Install rollback record: $transaction_file"
/bin/cp "$compatibility_report" "$profile/Bridge/.state/compatibility.json"
/bin/chmod 600 "$profile/Bridge/.state/compatibility.json"
DIA_CUSTOM_PROFILE="$profile" DIA_CUSTOM_MODS="$enabled_mods" "$script_dir/configure-profile.sh"
tx_finished=true

print "Built $clone_app"
print "Profile: $profile"
print "Dia Mods: $enabled_mods"
