#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
source_dir="$project_dir/src/bootstrap"
output_dir="$project_dir/.build/bootstrap"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p "$output_dir"

xcrun clang -c -Os -x objective-c -fblocks \
  -isysroot "$sdk_path" \
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
  -o "$output_dir/offline-bootstrap.dylib"

codesign --force --sign - "$output_dir/offline-bootstrap.dylib"
print "$output_dir/offline-bootstrap.dylib"
