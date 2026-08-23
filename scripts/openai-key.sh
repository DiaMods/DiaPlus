#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
credential_path="$profile/Bridge/.state/credentials.json"
node_bin="${DIA_CUSTOM_NODE:-$(command -v node || true)}"
if [[ -z "$node_bin" ]]; then
  print -u2 "Dia Custom needs Node.js to manage provider credentials."
  exit 1
fi

if [[ "${1:-}" == "--clear" ]]; then
  DIA_CUSTOM_CREDENTIALS_PATH="$credential_path" "$node_bin" --input-type=module -e \
    "import { CredentialStore } from '${project_dir}/bridge/src/credentials.js'; await new CredentialStore().delete('openai');"
  /bin/launchctl unsetenv OPENAI_API_KEY >/dev/null 2>&1 || true
  print "Removed the OpenAI API key from Dia Custom."
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
print -rn -- "$api_key" | DIA_CUSTOM_CREDENTIALS_PATH="$credential_path" "$node_bin" --input-type=module -e \
  "import { CredentialStore } from '${project_dir}/bridge/src/credentials.js'; let value=''; for await (const chunk of process.stdin) value += chunk; await new CredentialStore().set('openai', value);"
unset api_key
print "Saved the key in Dia Custom's owner-only credential store. Restart the bridge to refresh model discovery."
