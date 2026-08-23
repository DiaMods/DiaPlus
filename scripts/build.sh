#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
clone_app="${DIA_CUSTOM_APP:-$work_dir/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
bundle_id="local.rttm.dia"
replace=false

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
if [[ -e "$clone_app" && "$replace" != true ]]; then
  print -u2 "Dia Custom already exists at $clone_app"
  print -u2 "Use './dia-custom install' to refresh it, or 'build --replace' for a fresh clone."
  exit 1
fi
if [[ -e "$clone_app" ]] && /usr/bin/pgrep -f "$clone_app/Contents/MacOS/Dia" >/dev/null; then
  print -u2 "Quit Dia Custom before replacing its app bundle."
  exit 1
fi

mkdir -p "$work_dir" "${profile:h}"
temporary_app="$work_dir/Dia Custom RTTM.build.$$.app"
trap '[[ ! -e "$temporary_app" ]] || /bin/rm -rf "$temporary_app"' EXIT
/usr/bin/ditto "$source_app" "$temporary_app"

info="$temporary_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$info"
/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Dia Custom RTTM'" "$info"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 'Dia Custom RTTM'" "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Dia Custom RTTM'" "$info"
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$info" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Delete :CFBundleDocumentTypes" "$info" 2>/dev/null || true

"$script_dir/install.sh" "$temporary_app"

if [[ -e "$clone_app" ]]; then
  backup_app="$work_dir/Dia Custom RTTM.pre-rebuild.$(/bin/date +%Y%m%d-%H%M%S).app"
  /bin/mv "$clone_app" "$backup_app"
  print "Previous clone preserved at $backup_app"
fi
/bin/mv "$temporary_app" "$clone_app"
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
