#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
clone_app="${DIA_CUSTOM_APP:-/Applications/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
bundle_id="local.rttm.dia"
replace=false
install_stamp="$(/bin/date +%Y%m%d-%H%M%S)"

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

requested_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
enabled_mods="${DIA_CUSTOM_EFFECTIVE_MODS:-$requested_mods}"
mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}
node "$script_dir/check-dia-build.js" "$source_app" --mods "$enabled_mods" --allow-structural
compatibility_report="$(/usr/bin/mktemp -t dia-custom-build-compatibility).json"
node "$script_dir/compatibility.js" "$source_app" \
  --mods "$requested_mods" --json > "$compatibility_report"

if [[ -e "$clone_app" && "$replace" != true ]]; then
  print -u2 "Dia Custom already exists at $clone_app"
  print -u2 "Use './dia-custom install' to refresh it, or 'build --replace' for a fresh clone."
  exit 1
fi
if [[ -e "$clone_app" ]] && /usr/bin/pgrep -f "$clone_app/Contents/MacOS/Dia" >/dev/null; then
  print -u2 "Quit Dia Custom before replacing its app bundle."
  exit 1
fi

# A force-quit browser can leave its self-contained Node bridge orphaned. Stop
# only the PID recorded in this profile or a process whose complete command is
# the exact clone's bundled DiaCustomNode invocation; never kill an unrelated
# localhost app.
bridge_pid_file="$profile/Bridge/.state/bridge.pid"
bridge_pids=()
if [[ -f "$bridge_pid_file" ]]; then
  bridge_pid="$(/usr/bin/tr -cd '0-9' < "$bridge_pid_file")"
  [[ -z "$bridge_pid" ]] || bridge_pids+=("$bridge_pid")
fi
while IFS= read -r bridge_pid; do
  [[ -z "$bridge_pid" ]] || bridge_pids+=("$bridge_pid")
done < <(/usr/bin/pgrep -f "^${clone_app}/Contents/Helpers/DiaCustomNode ${clone_app}/Contents/Resources/DiaCustomBridge/src/server.js$" 2>/dev/null || true)
for bridge_pid in "${bridge_pids[@]}"; do
  bridge_command="$(ps -o command= -p "${bridge_pid:-0}" 2>/dev/null || true)"
  expected_command="$clone_app/Contents/Helpers/DiaCustomNode $clone_app/Contents/Resources/DiaCustomBridge/src/server.js"
  if [[ -n "$bridge_pid" && "$bridge_pid" -gt 1 &&
        "$bridge_command" == "$expected_command" ]]; then
    /bin/kill -TERM "$bridge_pid" >/dev/null 2>&1 || true
    for _ in {1..30}; do
      /bin/kill -0 "$bridge_pid" >/dev/null 2>&1 || break
      sleep 0.1
    done
  fi
done

profile_snapshot=""
if [[ -f "$profile/User Data/Local State" ]]; then
  profile_snapshot="$(DIA_CUSTOM_APP="$clone_app" \
    "$script_dir/snapshot-profile.sh" "$profile" "$work_dir/backups/profiles" \
      "pre-rebuild.$install_stamp")"
  print "Browser profile preserved at $profile_snapshot"
fi

mkdir -p "$work_dir" "${profile:h}"
temporary_app="$work_dir/Dia Custom RTTM.build.$$.app"
trap '[[ ! -e "$temporary_app" ]] || /bin/rm -rf "$temporary_app"; /bin/rm -f "$compatibility_report"' EXIT
/usr/bin/ditto "$source_app" "$temporary_app"

info="$temporary_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$info"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Dia Custom RTTM'" "$info"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 'Dia Custom RTTM'" "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Dia Custom RTTM'" "$info"
# Keep the standard web URL declarations under the clone's distinct bundle ID.
# Removing these made Launch Services and external automation unable to route a
# requested background tab to Dia Custom, even though its AppleScript tab API
# and Chromium controller were healthy.
/usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleURLName 'Dia Custom Website URL'" "$info"
/usr/libexec/PlistBuddy -c "Delete :CFBundleDocumentTypes" "$info" 2>/dev/null || true

DIA_CUSTOM_PROFILE="$profile" DIA_CUSTOM_MODS="$enabled_mods" \
  DIA_CUSTOM_SKIP_PROFILE_SNAPSHOT=1 \
  "$script_dir/install.sh" "$temporary_app"
"$script_dir/verify-staged.sh" "$temporary_app" "$enabled_mods"
if [[ -n "$profile_snapshot" ]]; then
  "$script_dir/preflight-profile.sh" "$temporary_app" "$profile_snapshot"
fi

backup_app=""
if [[ -e "$clone_app" ]]; then
  backup_dir="$work_dir/backups/apps"
  mkdir -p "$backup_dir"
  backup_app="$backup_dir/Dia Custom RTTM.pre-rebuild.$install_stamp.app"
  /bin/mv "$clone_app" "$backup_app"
  print "Previous clone preserved at $backup_app"
fi
if ! /bin/mv "$temporary_app" "$clone_app"; then
  if [[ -n "$backup_app" && -e "$backup_app" && ! -e "$clone_app" ]]; then
    /bin/mv "$backup_app" "$clone_app"
  fi
  print -u2 "The staged app could not be installed; the previous clone was restored."
  exit 1
fi
if ! "$script_dir/verify-staged.sh" "$clone_app" "$enabled_mods"; then
  failed_app="$work_dir/backups/apps/Dia Custom RTTM.failed.$(/bin/date +%Y%m%d-%H%M%S).app"
  mkdir -p "${failed_app:h}"
  /bin/mv "$clone_app" "$failed_app"
  if [[ -n "$backup_app" && -e "$backup_app" ]]; then
    /bin/mv "$backup_app" "$clone_app"
    print -u2 "Post-install verification failed; the previous clone was restored."
  else
    print -u2 "Post-install verification failed; the failed build was preserved at $failed_app."
  fi
  exit 1
fi

mkdir -p "$profile/Bridge/.state"
/bin/chmod 700 "$profile/Bridge/.state"
if [[ -n "$profile_snapshot" ]]; then
  transaction_file="$work_dir/backups/transactions/Dia Custom RTTM.pre-rebuild.$install_stamp.json"
  node "$script_dir/record-install-transaction.js" "$transaction_file" \
    "$clone_app" "$backup_app" "$profile" "$profile_snapshot"
  /bin/cp "$transaction_file" "$profile/Bridge/.state/latest-install-transaction.json"
  /bin/chmod 600 "$profile/Bridge/.state/latest-install-transaction.json"
  print "Install rollback record: $transaction_file"
fi
/bin/cp "$compatibility_report" "$profile/Bridge/.state/compatibility.json"
/bin/chmod 600 "$profile/Bridge/.state/compatibility.json"
/bin/rm -f "$compatibility_report"
trap - EXIT

/usr/bin/defaults write "$bundle_id" shouldShareUsageData -bool false
/usr/bin/defaults write "$bundle_id" firebaseSyncEnabled -bool false
/usr/bin/defaults write "$bundle_id" cloudKitSyncEnabled -bool false
/usr/bin/defaults write "$bundle_id" shouldAutomaticallyUpdate -bool false
/usr/bin/defaults write "$bundle_id" automaticallyUpdateArc -bool false
/usr/bin/defaults write "$bundle_id" shouldAutomaticallyUpdateArc -bool false
/usr/bin/defaults write "$bundle_id" SUEnableAutomaticChecks -bool false
/usr/bin/defaults write "$bundle_id" SUAutomaticallyUpdate -bool false
/usr/bin/defaults write "$bundle_id" SUScheduledCheckInterval -int 0
/usr/bin/defaults write "$bundle_id" canShowUpdateBanner -bool false

print "Built $clone_app"
print "Profile: $profile"
print "Dia Mods: $enabled_mods"
