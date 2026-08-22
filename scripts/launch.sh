#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
app="${DIA_CUSTOM_APP:-$work_dir/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
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
/usr/bin/defaults write local.rttm.dia transientFeatureFlagOverrides -array \
  "clia-agents-chat-enabled=true" \
  "force-classic-chat-enabled=false" \
  "clia-settings-toggle-always-visible-enabled=true" \
  "apps-pref-pane-redesign-enabled=true" \
  "auto-enable-clia-from-onboarding-enabled=true" \
  "clia-in-app-upsell-enabled=true" \
  "external-qa-access-for-developer-menu-enabled=true" \
  "enable-llm-debugger=true"

if ! /usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:8765/health >/dev/null 2>&1; then
  node_bin="${DIA_CUSTOM_NODE:-$(command -v node || true)}"
  if [[ -z "$node_bin" ]]; then
    print -u2 "Dia Custom needs Node.js to start its local AI bridge."
    exit 1
  fi

  /bin/launchctl remove "$bridge_label" >/dev/null 2>&1 || true
  : > "$bridge_log"
  bridge_environment=("DIA_CUSTOM_CAPTURE_DIR=$diagnostics_dir/Captures")
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
fi

launch_args=(
  -customApplicationDataBaseURLPath "$profile"
  --user-data-dir="$profile/User Data"
  --no-first-run
  --disable-background-networking
  --disable-component-update
  --disable-sync
  --remote-debugging-port=9223
  --use-mock-keychain
  --no-sandbox
)
launch_env=(
  --env "DIA_CUSTOM_RUNTIME_LOG=$runtime_log"
  --env "DIA_CUSTOM_NETWORK_LOG=$network_log"
)
if [[ "${DIA_CUSTOM_DEBUG_AGENT_MESSAGES:-0}" == "1" ]]; then
  launch_env+=(--env "MESSAGE_LOG_PAYLOADS=1")
fi

/usr/bin/open -n -a "$app" \
  "${launch_env[@]}" \
  --args \
  "${launch_args[@]}"
