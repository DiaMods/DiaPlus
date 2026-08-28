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
tool_coverage="$bridge_state_dir/tool-coverage.json"
provider_config="$bridge_state_dir/config.json"
memory_database="$bridge_state_dir/memory.sqlite3"
enabled_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ ! -d "$app" ]]; then
  print -u2 "Dia Custom is not installed. Run './dia-custom build' first."
  exit 1
fi
node "$script_dir/check-dia-build.js" "$app" --mods "$enabled_mods" >/dev/null
if [[ ! -f "$embedded_bootstrap" ]]; then
  "$script_dir/install.sh" "$app"
fi

mkdir -p "$diagnostics_dir" "$bridge_state_dir"
/bin/chmod 700 "$diagnostics_dir" "$bridge_state_dir"

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
  /bin/chmod 600 "$bridge_lock_marker"
fi
[[ ! -f "$bridge_lock_marker" ]] || /bin/chmod 600 "$bridge_lock_marker"

[[ -e "$network_log" ]] || : > "$network_log"
/bin/chmod 600 "$network_log"

# Complete the local anonymous setup and explicitly select New Chat flags.
if mod_enabled account-bypass; then
  /usr/bin/defaults write local.rttm.dia onboardingForceCompleteFlowEnabled -bool false
  /usr/bin/defaults write local.rttm.dia hasPresentedOnboardingIntro -bool true
  /usr/bin/defaults write local.rttm.dia hasUserAuthenticated -bool true
  /usr/bin/defaults write local.rttm.dia onboardingRemainingSteps -array
fi
/usr/bin/defaults write local.rttm.dia shouldAutomaticallyUpdate -bool false
/usr/bin/defaults write local.rttm.dia automaticallyUpdateArc -bool false
/usr/bin/defaults write local.rttm.dia shouldAutomaticallyUpdateArc -bool false
/usr/bin/defaults write local.rttm.dia SUEnableAutomaticChecks -bool false
/usr/bin/defaults write local.rttm.dia SUAutomaticallyUpdate -bool false
/usr/bin/defaults write local.rttm.dia SUScheduledCheckInterval -int 0
/usr/bin/defaults write local.rttm.dia canShowUpdateBanner -bool false
feature_flags=( \
  "clia-agents-chat-enabled=true" \
  "force-classic-chat-enabled=false" \
  "agent-thinking-ui-enabled=true" \
  "clia-thinking-enabled=true" \
  "tools-ui-revision-enabled=true" \
  "fetch-web-content-enabled=true" \
  "read-calendar-step-enabled=true" \
  "search-email-step-enabled=true" \
  "search-github-step-enabled=true" \
  "search-notion-step-enabled=true" \
  "search-slack-step-enabled=true" \
  "search-slack-bylines-enabled=true" \
  "clia-settings-toggle-always-visible-enabled=true" \
  "auto-enable-clia-from-onboarding-enabled=true" \
  "clia-in-app-upsell-enabled=true" \
  "clia-report-enabled=true" \
  "clia-artifact-in-chat-presentation-enabled=true" \
  "clia-artifact-tab-preview-enabled=true" \
  "external-qa-access-for-developer-menu-enabled=true" \
  "enable-llm-debugger=true" \
)
if mod_enabled native-apps; then
  feature_flags+=("apps-pref-pane-redesign-enabled=true")
fi
if mod_enabled morning-brief; then
  feature_flags+=(
    "clia-morning-brief-settings-enabled=true"
    "clia-morning-brief-allow-gmail-gcal-enabled=true"
    "clia-morning-brief-allow-msft-enabled=true"
    "clia-morning-brief-connect-apps-enabled=true"
    "clia-morning-brief-auto-focus-enabled=true"
    "clia-morning-brief-open-links-enabled=true"
    "clia-morning-brief-paper-window-enabled=true"
    "clia-morning-brief-paper-expand-into-tab-enabled=true"
    "context-builder-morning-brief-enabled=true"
  )
fi
/usr/bin/defaults write local.rttm.dia transientFeatureFlagOverrides -array "${feature_flags[@]}"

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
/bin/chmod 600 "$bridge_log"
bridge_environment=(
  "DIA_CUSTOM_CAPTURE_DIR=$diagnostics_dir/Captures"
  "DIA_CUSTOM_DEBUG_PORT=$debug_port"
  "DIA_CUSTOM_PROFILE=$profile"
  "DIA_CUSTOM_CONFIG_PATH=$provider_config"
  "DIA_CUSTOM_MODEL_CATALOG_PATH=$model_catalog"
  "DIA_CUSTOM_TOOL_COVERAGE_PATH=$tool_coverage"
  "DIA_CUSTOM_MEMORY_PATH=$memory_database"
  "DIA_CUSTOM_MODS=$enabled_mods"
)
if mod_enabled apple-models && [[ -x "$apple_model_helper" ]]; then
  bridge_environment+=("DIA_CUSTOM_APPLE_MODEL_HELPER=$apple_model_helper")
fi
[[ -z "${DIA_CUSTOM_CODEX_MODEL:-}" ]] || bridge_environment+=("DIA_CUSTOM_CODEX_MODEL=$DIA_CUSTOM_CODEX_MODEL")
[[ -z "${DIA_CUSTOM_WORKSPACE:-}" ]] || bridge_environment+=("DIA_CUSTOM_WORKSPACE=$DIA_CUSTOM_WORKSPACE")
[[ "${DIA_CUSTOM_CAPTURE:-0}" != "1" ]] || bridge_environment+=("DIA_CUSTOM_CAPTURE=1")
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
/bin/chmod 600 "$bridge_pid_file"

if [[ "$bridge_only" == true ]]; then
  print "Dia Custom bridge is ready at http://127.0.0.1:8765"
  print "Model settings: http://127.0.0.1:8765/settings"
  exit 0
fi

: > "$network_log"
/bin/chmod 600 "$network_log"

launch_args=(
  -customApplicationDataBaseURLPath "$profile"
  --user-data-dir="$profile/User Data"
  --no-first-run
  --disable-background-networking
  --disable-component-update
  --disable-sync
  '--host-resolver-rules=MAP diabrowser.engineering ~NOTFOUND, MAP *.diabrowser.engineering ~NOTFOUND, MAP diabrowser.com ~NOTFOUND, MAP *.diabrowser.com ~NOTFOUND, MAP thebrowser.company ~NOTFOUND, MAP *.thebrowser.company ~NOTFOUND, MAP thebrowser.com ~NOTFOUND, MAP *.thebrowser.com ~NOTFOUND, MAP browserinternal.com ~NOTFOUND, MAP *.browserinternal.com ~NOTFOUND, MAP browserinternalstaging.com ~NOTFOUND, MAP *.browserinternalstaging.com ~NOTFOUND, MAP api.segment.io ~NOTFOUND, MAP cdn-settings.segment.com ~NOTFOUND, MAP clientstream.launchdarkly.com ~NOTFOUND, MAP mobile.launchdarkly.com ~NOTFOUND, MAP browser-intake-datadoghq.com ~NOTFOUND, MAP browser-intake-ap1-datadoghq.com ~NOTFOUND, MAP browser-intake-datadoghq.eu ~NOTFOUND, MAP browser-intake-us3-datadoghq.com ~NOTFOUND, MAP browser-intake-us5-datadoghq.com ~NOTFOUND, MAP o298668.ingest.us.sentry.io ~NOTFOUND, EXCLUDE localhost'
  --remote-debugging-port="$debug_port"
  --use-mock-keychain
)
if [[ "${DIA_CUSTOM_DISABLE_BROWSER_SANDBOX:-0}" == "1" ]]; then
  print -u2 "Warning: Chromium sandbox disabled for this diagnostic launch."
  launch_args+=(--no-sandbox)
fi
launch_env=(
  --env "DIA_CUSTOM_RUNTIME_LOG=$runtime_log"
  --env "DIA_CUSTOM_NETWORK_LOG=$network_log"
  --env "DIA_CUSTOM_PROFILE=$profile"
  --env "DIA_CUSTOM_MODEL_CATALOG_PATH=$model_catalog"
  --env "DIA_CUSTOM_SETTINGS_URL=http://127.0.0.1:8765/settings"
  --env "DIA_CUSTOM_MODS=$enabled_mods"
)
if [[ "${DIA_CUSTOM_DEBUG_AGENT_MESSAGES:-0}" == "1" ]]; then
  launch_env+=(--env "MESSAGE_LOG_PAYLOADS=1")
fi

/usr/bin/open -n -a "$app" \
  "${launch_env[@]}" \
  --args \
  "${launch_args[@]}"
