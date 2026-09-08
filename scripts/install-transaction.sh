#!/bin/zsh
# Shared by build and refresh. All app renames remain on the target's volume.
# The live browser profile is never opened here; only these two state files and
# the clone's Finder preferences can change after staged verification succeeds.

transaction_defaults() { /usr/bin/defaults "$@"; }
transaction_staged_stopped() { node "$script_dir/browser-process-guard.js" assert-stopped "$tx_staged"; }

transaction_begin() {
  tx_app="$1"
  tx_staged="$2"
  tx_backup="$3"
  tx_failed="$4"
  tx_profile="$5"
  tx_preserved=false
  tx_swapped=false
  tx_finished=false
  tx_state_started=false
  tx_preferences_saved=false
  tx_preferences_existed=false
  tx_state_backup=""
}

transaction_capture_state() {
  tx_state_backup="$(/usr/bin/mktemp -d -t dia-custom-install-state)" || return
  /bin/chmod 700 "$tx_state_backup" || return
  local name
  for name in compatibility.json latest-install-transaction.json; do
    if [[ -e "$tx_profile/Bridge/.state/$name" ]]; then
      /bin/cp -p "$tx_profile/Bridge/.state/$name" "$tx_state_backup/$name" || return
    fi
  done
  if [[ "${DIA_CUSTOM_STAGING:-0}" != "1" ]]; then
    if transaction_defaults export local.rttm.dia - > "$tx_state_backup/preferences.plist" 2>/dev/null; then
      tx_preferences_existed=true
    fi
    tx_preferences_saved=true
  fi
}

transaction_swap() {
  if [[ -e "$tx_app" ]]; then
    /bin/mkdir -p "${tx_backup:h}" || return
    /bin/chmod 700 "${tx_backup:h}" || return
    /bin/mv "$tx_app" "$tx_backup" || return
    tx_preserved=true
  fi
  /bin/mv "$tx_staged" "$tx_app" || return
  tx_swapped=true
}

transaction_cleanup() {
  local result=$? rollback_failed=false name
  # Keep rollback running if one restoration step fails, and report the backup.
  set +e
  if [[ "$tx_finished" != true ]]; then
    if [[ "$tx_swapped" == true ]]; then
      /bin/mkdir -p "${tx_failed:h}"
      /bin/mv "$tx_app" "$tx_failed" || rollback_failed=true
    fi
    if [[ "$tx_preserved" == true && ! -e "$tx_app" ]]; then
      /bin/mv "$tx_backup" "$tx_app" || rollback_failed=true
    fi
    if [[ "$tx_state_started" == true && -n "$tx_state_backup" ]]; then
      for name in compatibility.json latest-install-transaction.json; do
        if [[ -f "$tx_state_backup/$name" ]]; then
          /bin/cp -p "$tx_state_backup/$name" "$tx_profile/Bridge/.state/$name" || rollback_failed=true
        else
          /bin/rm -f "$tx_profile/Bridge/.state/$name" || rollback_failed=true
        fi
      done
      if [[ "$tx_preferences_saved" == true ]]; then
        if [[ "$tx_preferences_existed" == true ]]; then
          transaction_defaults import local.rttm.dia "$tx_state_backup/preferences.plist" >/dev/null || rollback_failed=true
        else
          # A new domain may not exist if failure occurred before configuration.
          transaction_defaults delete local.rttm.dia >/dev/null 2>&1 || true
        fi
      fi
    fi
    if [[ "$rollback_failed" == true ]]; then
      print -u2 "Install rollback needs attention. App backup: $tx_backup; state backup: $tx_state_backup"
      result=1
    elif [[ "$tx_preserved" == true ]]; then
      print -u2 "Install failed; the previous app and configuration were restored."
    elif [[ "$tx_swapped" == true ]]; then
      print -u2 "Install failed; the previous configuration was restored. Failed build: $tx_failed"
    fi
  fi
  if [[ -e "$tx_staged" ]]; then
    if transaction_staged_stopped; then
      /bin/rm -rf "$tx_staged"
    else
      print -u2 "The staged app may still be running; preserved it at $tx_staged"
      result=1
    fi
  fi
  if [[ "$rollback_failed" != true && -n "$tx_state_backup" ]]; then
    /bin/rm -rf "$tx_state_backup"
  fi
  return "$result"
}
