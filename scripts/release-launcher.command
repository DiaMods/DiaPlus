#!/bin/zsh
set -euo pipefail
root="${0:A:h}"
runtime="$root/toolkit/.build/runtime"
archive="node-v24.20.0-darwin-arm64.tar.gz"
expected="40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8"
if [[ "$(/usr/bin/uname -m)" != arm64 ]]; then
  print -u2 'Dia+ requires an Apple Silicon Mac.'
  exit 1
fi
actual="$(/usr/bin/shasum -a 256 "$root/toolkit/runtime/$archive" | /usr/bin/awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { print -u2 'Bundled Node checksum mismatch.'; exit 1; }
mkdir -p "$runtime"
/usr/bin/tar -xzf "$root/toolkit/runtime/$archive" -C "$runtime"
export PATH="$runtime/node-v24.20.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
/bin/cp "$root/toolkit/runtime/$archive" "$runtime/$archive"
if ! node "$root/toolkit/scripts/release-install.js" "$@"; then
  print -u2 'Dia+ could not finish installing. The error is shown above.'
  [[ ! -t 0 ]] || read -r '?Press Return to close…'
  exit 1
fi
[[ ! -t 0 ]] || read -r '?Press Return to close…'
