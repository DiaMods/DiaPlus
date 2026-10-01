#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
fixture_dir="$(/usr/bin/mktemp -d -t dia-custom-advanced-chat)"
trap '/bin/rm -rf "$fixture_dir"' EXIT
xcrun clang -c -Os "$project_dir/src/bootstrap/offline-bootstrap-arm64.S" \
  -o "$fixture_dir/arm64.o"
for fixture in legacy rebrand daylight badtype unknown; do
  fixture_flags=()
  case "$fixture" in
    rebrand) fixture_flags=(-D REBRAND_LAYOUT) ;;
    daylight) fixture_flags=(-D DAYLIGHT_LAYOUT) ;;
    badtype) fixture_flags=(-D REBRAND_LAYOUT -D INVALID_TYPE) ;;
    unknown) fixture_flags=(-D REBRAND_LAYOUT -D UNKNOWN_LAYOUT) ;;
  esac
  xcrun swiftc -parse-as-library -O -module-name NewTabPage "${fixture_flags[@]}" \
    "$project_dir/src/bootstrap/offline-bootstrap-introspection.swift" \
    "$script_dir/test-advanced-chat.swift" "$fixture_dir/arm64.o" \
    -framework Foundation -framework AppKit -framework Combine \
    -o "$fixture_dir/$fixture"
  "$fixture_dir/$fixture"
done
