#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_file="$project_dir/src/apple-model-helper/main.swift"
output_dir="$project_dir/.build/apple-model-helper"
output_file="$output_dir/DiaCustomAppleModel"

developer_dir="${DIA_CUSTOM_XCODE_DEVELOPER_DIR:-}"
if [[ -z "$developer_dir" ]]; then
  for candidate in /Applications/Xcode-27*.app/Contents/Developer(N); do
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
  -o "$output_file"

/usr/bin/codesign --force --sign - "$output_file"
print "$output_file"
