#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
app="${DIA_CUSTOM_APP:-$work_dir/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
state_file="$profile/Bridge/.state/mods.json"
sync_status_file="$profile/Bridge/.state/official-sync-status.json"
sync_mode_file="$profile/Bridge/.state/official-sync-mode.json"
command="${1:-status}"
(( $# == 0 )) || shift
(( $# == 0 )) || {
  print -u2 "usage: ./dia-custom sync [enable|status|disable]"
  exit 2
}

mod_is_enabled() {
  local resolved
  resolved="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
  [[ ",$resolved," == *",$1,"* ]]
}

require_stopped_app() {
  if [[ -d "$app" ]] && /usr/bin/pgrep -f "$app/Contents/MacOS/Dia" >/dev/null; then
    print -u2 "Quit Dia Custom before changing its account and Sync build."
    exit 1
  fi
}

transactional_rebuild() {
  local action="$1"
  local temporary_dir had_state=false
  temporary_dir="$(/usr/bin/mktemp -d -t dia-custom-sync)"
  if [[ -f "$state_file" ]]; then
    had_state=true
    /bin/cp "$state_file" "$temporary_dir/mods.json"
  fi
  restore_state() {
    if [[ "$had_state" == true ]]; then
      mkdir -p "${state_file:h}"
      /bin/cp "$temporary_dir/mods.json" "$state_file"
      /bin/chmod 600 "$state_file"
    else
      /bin/rm -f "$state_file"
    fi
    /bin/rm -rf "$temporary_dir"
  }
  trap 'restore_state' INT TERM HUP
  if ! DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" \
      "$action" official-dia-sync; then
    restore_state
    trap - INT TERM HUP
    return 1
  fi
  if ! DIA_CUSTOM_PROFILE="$profile" "$script_dir/build.sh" --replace; then
    restore_state
    trap - INT TERM HUP
    return 1
  fi
  /bin/rm -rf "$temporary_dir"
  trap - INT TERM HUP
}

case "$command" in
  enable)
    require_stopped_app
    "$script_dir/signing-identity.sh" >/dev/null
    transactional_rebuild enable
    # account-bypass wrote this synthetic value. The native AuthClient must
    # now determine signed-in state from its own isolated credential store.
    /usr/bin/defaults delete local.rttm.dia hasUserAuthenticated \
      >/dev/null 2>&1 || true
    if [[ -f "$profile/User Data/Local State" ]]; then
      DIA_CUSTOM_OPEN_ACCOUNT_AFTER_LAUNCH=1 \
        DIA_CUSTOM_PROFILE="$profile" "$script_dir/launch.sh"
    else
      DIA_CUSTOM_PROFILE="$profile" "$script_dir/launch.sh"
    fi
    print "Official Dia Sync is installed. Complete the native Dia account and Sync flow."
    ;;
  disable)
    require_stopped_app
    if [[ "$(/usr/bin/defaults read local.rttm.dia cloudKitSyncEnabled 2>/dev/null || print 0)" == "1" ]]; then
      print -u2 "Disable Sync in Dia's native Account/Sync settings first."
      print -u2 "Choose whether to delete the encrypted server data there, then retry."
      exit 1
    fi
    transactional_rebuild disable
    /bin/rm -f "$sync_status_file" "$sync_mode_file"
    DIA_CUSTOM_PROFILE="$profile" "$script_dir/launch.sh"
    print "Official Dia Sync access is disabled; anonymous local mode is restored."
    ;;
  status)
    if mod_is_enabled official-dia-sync; then
      print "Official Dia Sync mod: enabled"
    else
      print "Official Dia Sync mod: disabled"
    fi
    installed_sync=false
    if [[ -d "$app" ]] && /usr/libexec/PlistBuddy -c Print:DiaCustomEnabledMods \
        "$app/Contents/Info.plist" 2>/dev/null | /usr/bin/grep -Eq \
        '(^|,)official-dia-sync(,|$)'; then
      installed_sync=true
      print "Installed build: Sync-capable"
    else
      print "Installed build: anonymous-only"
    fi
    native_enabled="$(/usr/bin/defaults read local.rttm.dia cloudKitSyncEnabled 2>/dev/null || print 0)"
    native_linked="$(/usr/bin/defaults read local.rttm.dia hasUserAuthenticated 2>/dev/null || print 0)"
    sync_mode="$(/usr/bin/plutil -extract mode raw -o - \
      "$sync_mode_file" 2>/dev/null || true)"
    if [[ "$installed_sync" == true && "$sync_mode" == "enabled" ]]; then
      print "Native Dia account: $([[ "$native_linked" == "1" ]] && print linked || print not linked)"
    elif [[ "$installed_sync" == true ]]; then
      print "Native Dia account: not linked (Sync build has not launched for this profile)"
    else
      print "Native Dia account: unavailable in anonymous build"
    fi
    print "Native Sync preference: $([[ "$native_enabled" == "1" ]] && print on || print off)"
    print "Encryption policy: $([[ "$installed_sync" == true ]] && print required || print inactive)"
    last_success="$(/usr/bin/plutil -extract lastSuccessfulServiceResponse raw \
      -o - "$sync_status_file" 2>/dev/null || true)"
    if [[ -n "$last_success" ]]; then
      last_success_seconds="$(printf '%.0f' "$last_success")"
      print "Last successful Sync service response: $(/bin/date -r "$last_success_seconds" '+%Y-%m-%d %H:%M:%S %Z')"
    else
      print "Last successful Sync service response: none observed"
    fi
    print "Account details and recovery keys are intentionally not read by this command."
    ;;
  *)
    print -u2 "usage: ./dia-custom sync [enable|status|disable]"
    exit 2
    ;;
esac
