#!/bin/zsh
set -euo pipefail

if [[ "${1:-}" == "--clear" ]]; then
  /bin/launchctl unsetenv OPENAI_API_KEY
  print "Removed the OpenAI API key from this login session."
  exit 0
fi
if (( $# != 0 )); then
  print -u2 "usage: ./dia-custom openai-key [--clear]"
  exit 2
fi
if [[ ! -t 0 ]]; then
  print -u2 "Run this command in a terminal so the key can be entered privately."
  exit 1
fi

read -rs "api_key?OpenAI API key: "
print
if [[ -z "$api_key" ]]; then
  print -u2 "No key was entered."
  exit 1
fi
/bin/launchctl setenv OPENAI_API_KEY "$api_key"
unset api_key
print "Saved the key in this macOS login session. Restart with './dia-custom bridge' or './dia-custom launch'."
