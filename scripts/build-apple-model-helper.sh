#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_file="$project_dir/src/apple-model-helper/main.swift"
output_dir="$project_dir/.build/apple-model-helper"
output_file="$output_dir/DiaCustomAppleModel"

prebuilt="$(node "$script_dir/prebuilt.js" apple-model)"
if [[ -n "$prebuilt" ]]; then
  print "$prebuilt"
  exit 0
fi

developer_dir="${DIA_CUSTOM_XCODE_DEVELOPER_DIR:-${DEVELOPER_DIR:-}}"
if [[ -z "$developer_dir" ]]; then
  active_developer_dir="$(/usr/bin/xcode-select --print-path 2>/dev/null || true)"
  active_sdk_version="$(DEVELOPER_DIR="$active_developer_dir" xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)"
  if [[ -d "$active_developer_dir" && "${active_sdk_version%%.*}" == <27-> ]]; then
    developer_dir="$active_developer_dir"
  fi
fi
if [[ -z "$developer_dir" ]]; then
  for candidate in /Applications/Xcode*27*.app/Contents/Developer(N); do
    if [[ -d "$candidate" ]]; then
      developer_dir="$candidate"
      break
    fi
  done
fi

if [[ -z "$developer_dir" || ! -d "$developer_dir" ]]; then
  print -u2 "Apple Foundation Models support needs Xcode 27 or newer to build."
  exit 1
fi

mkdir -p "$output_dir"
DEVELOPER_DIR="$developer_dir" xcrun swiftc \
  -parse-as-library \
  -O \
  -target arm64-apple-macosx27.0 \
  -framework FoundationModels \
  -framework NaturalLanguage \
  "$source_file" \
  "$project_dir/src/apple-model-helper/ocr-compatibility.swift" \
  -o "$output_file"

/usr/bin/codesign --force --sign - "$output_file"
print "$output_file"
