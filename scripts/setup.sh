#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
source_app="${1:-/Applications/Dia.app}"
source_app="${source_app:A}"
target_app="${DIA_CUSTOM_APP:-$("$script_dir/default-app.sh")}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
legacy_profile="${DIA_CUSTOM_LEGACY_PROFILE:-$work_dir/dia-custom-profile}"

if [[ ! -d "$source_app" ]]; then
  print -u2 "Official Dia was not found at $source_app"
  print -u2 "Usage: ./dia-custom setup [/path/to/Dia.app]"
  exit 1
fi
source_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
  "$source_app/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$source_id" != "company.thebrowser.dia" ]]; then
  print -u2 "$source_app is not an official Dia app bundle."
  exit 1
fi

if /usr/bin/pgrep -f '/Dia( Custom[^/]*|\+[^/]*)/Contents/MacOS/Dia' >/dev/null; then
  /usr/bin/osascript -e 'tell application id "local.rttm.dia" to quit' \
    >/dev/null 2>&1 || true
  for _ in {1..100}; do
    /usr/bin/pgrep -f '/Dia( Custom[^/]*|\+[^/]*)/Contents/MacOS/Dia' >/dev/null || break
    sleep 0.1
  done
fi
if /usr/bin/pgrep -f '/Dia( Custom[^/]*|\+[^/]*)/Contents/MacOS/Dia' >/dev/null; then
  print -u2 "Please quit Dia Custom, then run setup again."
  exit 1
fi

# A clean source shutdown lets SQLite's backup API capture History and
# Favicons consistently and prevents an updater from changing the source app
# while its audited clone is being assembled.
if /usr/bin/pgrep -f "$source_app/Contents/MacOS/Dia" >/dev/null; then
  print "Closing official Dia briefly to prepare a consistent import snapshot."
  /usr/bin/osascript -e 'tell application id "company.thebrowser.dia" to quit' \
    >/dev/null 2>&1 || true
  for _ in {1..100}; do
    /usr/bin/pgrep -f "$source_app/Contents/MacOS/Dia" >/dev/null || break
    sleep 0.1
  done
fi
if /usr/bin/pgrep -f "$source_app/Contents/MacOS/Dia" >/dev/null; then
  print -u2 "Please quit official Dia, then run setup again so its data can be copied safely."
  exit 1
fi

print "Installing Dia Custom from $source_app"
DIA_CUSTOM_SOURCE_APP="$source_app" DIA_CUSTOM_APP="$target_app" \
  "$script_dir/build.sh" --replace

if [[ -f "$profile/User Data/Local State" &&
      -f "$legacy_profile/User Data/Local State" ]]; then
  node "$script_dir/consolidate-profile.js" \
    --canonical "$profile" --legacy "$legacy_profile"
fi

enabled_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
if [[ ",$enabled_mods," == *",dia-import,"* &&
      -f "$HOME/Library/Application Support/Dia/User Data/Local State" ]]; then
  node "$script_dir/prepare-dia-import.js"
  if [[ ! -f "$profile/User Data/Local State" ]]; then
    mkdir -p "$profile/Bridge/.state"
    /bin/chmod 700 "$profile/Bridge/.state"
    : > "$profile/Bridge/.state/open-dia-import"
    /bin/chmod 600 "$profile/Bridge/.state/open-dia-import"
  fi
fi

/usr/bin/open -a "$target_app"
print "Dia Custom is installed in Applications and ready to use."
