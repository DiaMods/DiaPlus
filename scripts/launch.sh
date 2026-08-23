#!/bin/zsh
set -euo pipefail

bridge_only=false
if [[ "${1:-}" == "--bridge-only" ]]; then
  bridge_only=true
  shift
fi
if (( $# != 0 )); then
  print -u2 "usage: ./dia-custom launch [--bridge-only]"
  exit 2
fi

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
app="${DIA_CUSTOM_APP:-$work_dir/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
debug_port="${DIA_CUSTOM_DEBUG_PORT:-9223}"
embedded_bootstrap="$app/Contents/Frameworks/DiaCustomBootstrap.dylib"
bridge_source_dir="$project_dir/bridge"
bridge_dir="$profile/Bridge"
bridge_state_dir="$bridge_dir/.state"
bridge_log="$bridge_state_dir/bridge.log"
bridge_pid_file="$bridge_state_dir/bridge.pid"
bridge_lock_marker="$bridge_state_dir/package-lock.sha256"
bridge_label="local.rttm.dia.bridge"
diagnostics_dir="$profile/Diagnostics"
runtime_log="$diagnostics_dir/runtime-classes.txt"
network_log="$diagnostics_dir/network-requests.txt"
apple_model_helper="$app/Contents/Helpers/DiaCustomAppleModel"
model_catalog="$bridge_state_dir/models.json"
provider_config="$bridge_state_dir/config.json"
memory_database="$bridge_state_dir/memory.sqlite3"

if [[ ! -d "$app" ]]; then
  print -u2 "Dia Custom is not installed. Run './dia-custom build' first."
  exit 1
fi
if [[ ! -f "$embedded_bootstrap" ]]; then
  "$script_dir/install.sh" "$app"
fi

mkdir -p "$diagnostics_dir" "$bridge_state_dir"

# launchd cannot reliably read projects in macOS-protected Documents folders.
# Deploy the runnable bridge into this app's private profile; retain local state.
/usr/bin/rsync -a --delete \
  --exclude .state \
  --exclude node_modules \
  "$bridge_source_dir/" "$bridge_dir/"

lock_checksum="$(/usr/bin/shasum -a 256 "$bridge_source_dir/package-lock.json" | /usr/bin/awk '{print $1}')"
installed_checksum="$(test -f "$bridge_lock_marker" && /bin/cat "$bridge_lock_marker" || true)"
if [[ ! -d "$bridge_dir/node_modules/@openai/codex-sdk" || "$lock_checksum" != "$installed_checksum" ]]; then
  npm_bin="${DIA_CUSTOM_NPM:-$(command -v npm || true)}"
  if [[ -z "$npm_bin" ]]; then
    print -u2 "Dia Custom needs npm to install its local bridge dependency."
    exit 1
  fi
  (cd "$bridge_dir" && "$npm_bin" ci --omit=dev)
  print -r -- "$lock_checksum" > "$bridge_lock_marker"
fi

: > "$network_log"

# Complete the local anonymous setup and explicitly select New Chat flags.
/usr/bin/defaults write local.rttm.dia onboardingForceCompleteFlowEnabled -bool false
/usr/bin/defaults write local.rttm.dia hasPresentedOnboardingIntro -bool true
/usr/bin/defaults write local.rttm.dia hasUserAuthenticated -bool true
/usr/bin/defaults write local.rttm.dia onboardingRemainingSteps -array
/usr/bin/defaults write local.rttm.dia shouldAutomaticallyUpdate -bool false
/usr/bin/defaults write local.rttm.dia automaticallyUpdateArc -bool false
/usr/bin/defaults write local.rttm.dia shouldAutomaticallyUpdateArc -bool false
/usr/bin/defaults write local.rttm.dia SUEnableAutomaticChecks -bool false
/usr/bin/defaults write local.rttm.dia SUAutomaticallyUpdate -bool false
/usr/bin/defaults write local.rttm.dia SUScheduledCheckInterval -int 0
/usr/bin/defaults write local.rttm.dia canShowUpdateBanner -bool false
/usr/bin/defaults write local.rttm.dia transientFeatureFlagOverrides -array \
  "clia-agents-chat-enabled=true" \
  "force-classic-chat-enabled=false" \
  "clia-settings-toggle-always-visible-enabled=true" \
  "apps-pref-pane-redesign-enabled=true" \
  "auto-enable-clia-from-onboarding-enabled=true" \
  "clia-in-app-upsell-enabled=true" \
  "external-qa-access-for-developer-menu-enabled=true" \
  "enable-llm-debugger=true"

node_bin="${DIA_CUSTOM_NODE:-$(command -v node || true)}"
if [[ -z "$node_bin" ]]; then
  print -u2 "Dia Custom needs Node.js to start its local AI bridge."
  exit 1
fi
if ! "$node_bin" -e 'import("node:sqlite")' >/dev/null 2>&1; then
  print -u2 "Dia Custom needs Node.js 22.5 or newer for its local memory database."
  exit 1
fi

# Restart on every explicit launch so source and environment changes cannot
# leave an older bridge process serving the newly patched browser.
/bin/launchctl remove "$bridge_label" >/dev/null 2>&1 || true
sleep 0.1
: > "$bridge_log"
bridge_environment=(
  "DIA_CUSTOM_CAPTURE_DIR=$diagnostics_dir/Captures"
  "DIA_CUSTOM_DEBUG_PORT=$debug_port"
  "DIA_CUSTOM_PROFILE=$profile"
  "DIA_CUSTOM_CONFIG_PATH=$provider_config"
  "DIA_CUSTOM_MODEL_CATALOG_PATH=$model_catalog"
  "DIA_CUSTOM_MEMORY_PATH=$memory_database"
)
[[ ! -x "$apple_model_helper" ]] || bridge_environment+=("DIA_CUSTOM_APPLE_MODEL_HELPER=$apple_model_helper")
[[ -z "${DIA_CUSTOM_CODEX_MODEL:-}" ]] || bridge_environment+=("DIA_CUSTOM_CODEX_MODEL=$DIA_CUSTOM_CODEX_MODEL")
[[ -z "${DIA_CUSTOM_WORKSPACE:-}" ]] || bridge_environment+=("DIA_CUSTOM_WORKSPACE=$DIA_CUSTOM_WORKSPACE")
/bin/launchctl submit \
  -l "$bridge_label" \
  -o "$bridge_log" \
  -e "$bridge_log" \
  -- /usr/bin/env "${bridge_environment[@]}" "$node_bin" "$bridge_dir/src/server.js"

bridge_ready=false
for _ in {1..50}; do
  if /usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:8765/health >/dev/null 2>&1; then
    bridge_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$bridge_ready" != true ]]; then
  print -u2 "Dia Custom's local AI bridge did not start. See $bridge_log"
  exit 1
fi
/usr/sbin/lsof -nP -t -iTCP:8765 -sTCP:LISTEN > "$bridge_pid_file"

if [[ "$bridge_only" == true ]]; then
  print "Dia Custom bridge is ready at http://127.0.0.1:8765"
  print "Model settings: http://127.0.0.1:8765/settings"
  exit 0
fi

launch_args=(
  -customApplicationDataBaseURLPath "$profile"
  --user-data-dir="$profile/User Data"
  --no-first-run
  --disable-background-networking
  --disable-component-update
  --disable-sync
  --remote-debugging-port="$debug_port"
  --use-mock-keychain
  --no-sandbox
)
launch_env=(
  --env "DIA_CUSTOM_RUNTIME_LOG=$runtime_log"
  --env "DIA_CUSTOM_NETWORK_LOG=$network_log"
  --env "DIA_CUSTOM_MODEL_CATALOG_PATH=$model_catalog"
  --env "DIA_CUSTOM_SETTINGS_URL=http://127.0.0.1:8765/settings"
)
if [[ "${DIA_CUSTOM_DEBUG_AGENT_MESSAGES:-0}" == "1" ]]; then
  launch_env+=(--env "MESSAGE_LOG_PAYLOADS=1")
fi

/usr/bin/open -n -a "$app" \
  "${launch_env[@]}" \
  --args \
  "${launch_args[@]}"
