#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
allow_disable=false

while (( $# > 0 )); do
  case "$1" in
    --allow-disable-incompatible) allow_disable=true ;;
    --help|-h)
      print 'usage: ./dia-custom update [/path/to/Dia.app] [--allow-disable-incompatible]'
      exit 0
      ;;
    --*)
      print -u2 "Unknown update option: $1"
      exit 2
      ;;
    *) source_app="${1:A}" ;;
  esac
  shift
done

if [[ ! -d "$source_app" ]]; then
  print -u2 "Official Dia was not found at $source_app"
  exit 1
fi

requested_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
report_file="$(/usr/bin/mktemp -t dia-custom-compatibility)"
trap '/bin/rm -f "$report_file"' EXIT
node "$script_dir/compatibility.js" "$source_app" \
  --mods "$requested_mods" --json > "$report_file"

required_failures="$(node -e '
  const v=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(v.requiredFailures.map(x=>`${x.id}: ${x.reason}`).join("\n"));
' "$report_file")"
optional_failures="$(node -e '
  const v=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(v.optionalFailures.map(x=>`${x.id}: ${x.reason}`).join("\n"));
' "$report_file")"

if [[ -n "$required_failures" ]]; then
  print -u2 "The update was not installed because required safety/routing Mods are incompatible:"
  print -u2 -- "$required_failures"
  print -u2 "The current Dia Custom app was left untouched."
  exit 1
fi

if [[ -n "$optional_failures" && "$allow_disable" != true ]]; then
  if [[ ! -t 0 ]]; then
    print -u2 "Optional Mods are incompatible and non-interactive updates fail closed:"
    print -u2 -- "$optional_failures"
    print -u2 "Pass --allow-disable-incompatible to stage the update without them."
    exit 1
  fi
  print "The following optional Dia Mods are incompatible with this Dia build:"
  print -- "$optional_failures"
  print -n "Continue with those Mods temporarily unavailable? [y/N] "
  read -r answer
  if [[ "${answer:l}" != "y" && "${answer:l}" != "yes" ]]; then
    print "Update cancelled; the current Dia Custom app was left untouched."
    exit 0
  fi
fi

effective_mods="$(node -e '
  const v=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));process.stdout.write(v.effectiveMods.join(","));
' "$report_file")"
print "Building a staged Dia Custom clone from Dia $(node -e '
  const v=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));process.stdout.write(`${v.version} (${v.build})`);
' "$report_file")"

DIA_CUSTOM_SOURCE_APP="$source_app" \
DIA_CUSTOM_EFFECTIVE_MODS="$effective_mods" \
  "$script_dir/build.sh" --replace

mkdir -p "$profile/Bridge/.state"
/bin/chmod 700 "$profile/Bridge/.state"
/bin/cp "$report_file" "$profile/Bridge/.state/compatibility.json"
/bin/chmod 600 "$profile/Bridge/.state/compatibility.json"

if [[ -n "$optional_failures" ]]; then
  print "Update installed. Incompatible optional Mods are marked unavailable for this build."
else
  print "Update installed with every requested Dia Mod active."
fi
