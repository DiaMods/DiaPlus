#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
app="${DIA_CUSTOM_APP:-/Applications/Dia Custom RTTM.app}"
action="${1:-open}"

if [[ "$action" == "status" ]]; then
  exec node "$script_dir/prepare-dia-import.js" --status
fi
if [[ "$action" != "open" && "$action" != "prepare" ]]; then
  print -u2 "usage: ./dia-custom migrate [open|prepare|status]"
  exit 2
fi
enabled_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
if [[ ",$enabled_mods," != *",dia-import,"* ]]; then
  print -u2 "Enable the 'Import from official Dia' Dia Mod and rebuild first."
  exit 1
fi

node "$script_dir/prepare-dia-import.js"
if [[ "$action" == "prepare" ]]; then
  exit 0
fi
if [[ ! -d "$app" ]]; then
  print -u2 "Dia Custom is not installed at $app"
  exit 1
fi
mkdir -p "$profile/Bridge/.state"
/bin/chmod 700 "$profile/Bridge/.state"
: > "$profile/Bridge/.state/open-dia-import"
/bin/chmod 600 "$profile/Bridge/.state/open-dia-import"
print "Dia Custom will open its native browser importer with Dia as the source."
if /usr/bin/pgrep -f "$app/Contents/MacOS/Dia" >/dev/null; then
  /usr/bin/open -a "$app"
else
  exec "$script_dir/launch.sh"
fi
