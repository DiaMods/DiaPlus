#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_dir="$project_dir/src/bootstrap"
output_dir="$project_dir/.build/bootstrap"
source_app="${1:-${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}}"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"

if [[ ! -d "$source_app" ]]; then
  print -u2 "Dia is not installed at $source_app"
  exit 1
fi
source_binary="$source_app/Contents/MacOS/Dia"
source_info="$source_app/Contents/Info.plist"
source_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$source_info")"

mkdir -p "$output_dir"
node "$project_dir/research/tools/discover-prompt-tools.js" \
  "$source_binary" "$source_build" --header > "$output_dir/prompt-tools-offsets.h"
enabled_mods="${DIA_CUSTOM_EFFECTIVE_MODS:-$(node "$project_dir/scripts/mods.js" resolved)}"
if [[ ",${enabled_mods}," == *,morning-brief,* ]]; then
  node "$source_dir/discover-native-actions.js" \
    "$source_binary" "$source_build" --header > "$output_dir/native-actions-offsets.h"
else
  # A compatibility retry can omit Morning Brief without binding its private ABI.
  cat > "$output_dir/native-actions-offsets.h" <<'HEADER'
#define DIA_CUSTOM_NATIVE_ACTION_BUILD ""
#define DIA_CUSTOM_MORNING_BRIEF_OFFSET 0
static const uint32_t dia_custom_morning_brief_signature[] = {0};
HEADER
fi

xcrun clang -c -Os -x objective-c -fblocks \
  -isysroot "$sdk_path" \
  -I "$output_dir" \
  "$source_dir/offline-bootstrap.c" \
  -o "$output_dir/offline-bootstrap.o"

xcrun clang -c -Os \
  -isysroot "$sdk_path" \
  "$source_dir/offline-bootstrap-arm64.S" \
  -o "$output_dir/offline-bootstrap-arm64.o"

xcrun swiftc -emit-library -O \
  -sdk "$sdk_path" \
  "$source_dir/offline-bootstrap-introspection.swift" \
  "$output_dir/offline-bootstrap.o" \
  "$output_dir/offline-bootstrap-arm64.o" \
  -framework Foundation \
  -framework AppKit \
  -framework WebKit \
  -o "$output_dir/offline-bootstrap.dylib"

codesign --force --sign - "$output_dir/offline-bootstrap.dylib"
print "$output_dir/offline-bootstrap.dylib"
