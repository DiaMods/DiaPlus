#!/bin/zsh
set -euo pipefail
for app in '/Applications/Dia+.app' "$HOME/Applications/Dia+.app" \
  '/Applications/Dia Custom RTTM.app' "$HOME/Applications/Dia Custom RTTM.app"; do
  if [[ -d "$app" ]]; then
    print -r -- "$app"
    exit 0
  fi
done
print -r -- '/Applications/Dia+.app'
