#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
profile="${1:-${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}}"
backup_root="${2:-$work_dir/backups/profiles}"
label="${3:-pre-install.$(/bin/date +%Y%m%d-%H%M%S)}"
app="${DIA_CUSTOM_APP:-/Applications/Dia Custom RTTM.app}"

if (( $# > 3 )); then
  print -u2 "usage: snapshot-profile.sh [PROFILE [BACKUP_ROOT [LABEL]]]"
  exit 2
fi
app="${app:A}"
profile="${profile:A}"
if [[ -z "$label" || "$label" == *[^A-Za-z0-9._-]* ]]; then
  print -u2 "Unsafe profile snapshot label: $label"
  exit 2
fi
if [[ ! -f "$profile/User Data/Local State" ]]; then
  exit 0
fi
if ! node "$script_dir/browser-process-guard.js" assert-stopped "$app" "$profile"; then
  print -u2 "Quit Dia Custom before snapshotting its browser profile."
  exit 1
fi

mkdir -p "$backup_root"
/bin/chmod 700 "$backup_root"
snapshot="$backup_root/Dia Custom RTTM.$label.profile"
if [[ -e "$snapshot" ]]; then
  snapshot="$backup_root/Dia Custom RTTM.$label.$$.profile"
fi

# APFS clone-copy keeps a complete rollback point without duplicating every
# profile block. This includes Chromium sessions, Dia's pinned-tab database,
# extension packages, and every extension's local data store.
/bin/cp -cR "$profile" "$snapshot"
/bin/chmod 700 "$snapshot"
umask 077
node "$script_dir/profile-integrity.js" inventory "$profile" \
  > "$snapshot/.dia-custom-profile-snapshot.json"
/bin/chmod 600 "$snapshot/.dia-custom-profile-snapshot.json"
node "$script_dir/profile-integrity.js" assert-snapshot "$profile" "$snapshot" \
  >/dev/null

print -r -- "$snapshot"
