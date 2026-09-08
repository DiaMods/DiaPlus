#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
app="${1:?custom app required}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
work_dir="${DIA_CUSTOM_WORK_DIR:-${script_dir:h:h}}"
stamp="$(/bin/date +%Y%m%d-%H%M%S).$$"
staged="${app:h}/Dia Custom RTTM.refresh.$stamp.app"
backup="${app:h}/.dia-custom-backups/Dia Custom RTTM.pre-install.$stamp.app"
failed="${app:h}/.dia-custom-backups/Dia Custom RTTM.failed-install.$stamp.app"
snapshot=""
node "$script_dir/check-app-target.js" install "$app"
node "$script_dir/browser-process-guard.js" assert-stopped "$app" "$profile"
source "$script_dir/install-transaction.sh"
transaction_begin "$app" "$staged" "$backup" "$failed" "$profile"
trap transaction_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "${DIA_CUSTOM_STAGING:-0}" != "1" ]]; then
  /bin/launchctl remove local.rttm.dia.bridge >/dev/null 2>&1 || true
fi
node "$script_dir/bridge-runtime.js" stop "$app"
if [[ -f "$profile/User Data/Local State" ]]; then
  snapshot="$(DIA_CUSTOM_APP="$app" "$script_dir/snapshot-profile.sh" "$profile" "$work_dir/backups/profiles" "pre-install.$stamp")"
fi
# All patching and signing runs on a disposable copy before the app is replaced.
/bin/cp -cR "$app" "$staged"
DIA_CUSTOM_SKIP_PROFILE_SNAPSHOT=1 DIA_CUSTOM_STAGING=1 "$script_dir/install.sh" "$staged"
mods="$(/usr/libexec/PlistBuddy -c 'Print :DiaCustomEnabledMods' "$staged/Contents/Info.plist")"
"$script_dir/verify-staged.sh" "$staged" "$mods"
if [[ -n "$snapshot" ]]; then
  "$script_dir/preflight-profile.sh" "$staged" "$snapshot"
fi
transaction_capture_state || exit $?
transaction_swap || exit $?
"$script_dir/verify-staged.sh" "$app" "$mods"
transaction="$work_dir/backups/transactions/Dia Custom RTTM.pre-install.$stamp.json"
node "$script_dir/record-install-transaction.js" "$transaction" "$app" "$backup" "$profile" "$snapshot"
tx_state_started=true
mkdir -p "$profile/Bridge/.state"
/bin/chmod 700 "$profile/Bridge/.state"
/bin/cp "$transaction" "$profile/Bridge/.state/latest-install-transaction.json"
/bin/chmod 600 "$profile/Bridge/.state/latest-install-transaction.json"
DIA_CUSTOM_PROFILE="$profile" DIA_CUSTOM_MODS="$mods" "$script_dir/configure-profile.sh"
tx_finished=true
print "Installed $app; rollback record: $transaction"
