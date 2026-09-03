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
app="${DIA_CUSTOM_APP:-/Applications/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
debug_port="${DIA_CUSTOM_DEBUG_PORT:-9223}"
embedded_bootstrap="$app/Contents/Frameworks/DiaCustomBootstrap.dylib"
bridge_dir="$app/Contents/Resources/DiaCustomBridge"
mutable_bridge_state_dir="$profile/Bridge/.state"
bridge_log="$mutable_bridge_state_dir/bridge.log"
bridge_pid_file="$mutable_bridge_state_dir/bridge.pid"
bridge_label="local.rttm.dia.bridge"
diagnostics_dir="$profile/Diagnostics"
runtime_log="$diagnostics_dir/runtime-classes.txt"
network_log="$diagnostics_dir/network-requests.txt"
apple_model_helper="$app/Contents/Helpers/DiaCustomAppleModel"
model_catalog="$mutable_bridge_state_dir/models.json"
tool_coverage="$mutable_bridge_state_dir/tool-coverage.json"
provider_config="$mutable_bridge_state_dir/config.json"
memory_database="$mutable_bridge_state_dir/memory.sqlite3"
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
fresh_profile=false
[[ -f "$profile/User Data/Local State" ]] || fresh_profile=true
node "$script_dir/check-dia-build.js" "$app" --mods "$enabled_mods" >/dev/null
if [[ ! -f "$embedded_bootstrap" ]]; then
  "$script_dir/install.sh" "$app"
fi

mkdir -p "$diagnostics_dir" "$mutable_bridge_state_dir"
/bin/chmod 700 "$diagnostics_dir" "$mutable_bridge_state_dir"

# Dia's native importer reads a Chromium-shaped source profile. Create a
# scrubbed local source once, and offer the native flow on a fresh custom
# profile. `./dia-custom migrate` refreshes the staging copy on demand later.
if mod_enabled dia-import; then
  official_dia_state="${HOME}/Library/Application Support/Dia/User Data/Local State"
  staged_dia_manifest="${HOME}/Library/Application Support/DiaImport/.dia-custom-import.json"
  if [[ -f "$official_dia_state" && ! -f "$staged_dia_manifest" ]]; then
    if ! node "$script_dir/prepare-dia-import.js"; then
      print -u2 "Warning: official Dia data could not be prepared for import."
    fi
  fi
  if [[ "$fresh_profile" == true && -f "$staged_dia_manifest" ]]; then
    : > "$mutable_bridge_state_dir/open-dia-import"
    /bin/chmod 600 "$mutable_bridge_state_dir/open-dia-import"
  fi
fi

if [[ ! -x "$app/Contents/Helpers/DiaCustomNode" ||
      ! -f "$bridge_dir/src/server.js" ]]; then
  print -u2 "Dia Custom's self-contained runtime is missing. Run './dia-custom install'."
  exit 1
fi

[[ -e "$network_log" ]] || : > "$network_log"
/bin/chmod 600 "$network_log"

DIA_CUSTOM_PROFILE="$profile" "$script_dir/configure-profile.sh"

node_bin="$app/Contents/Helpers/DiaCustomNode"
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
  "DIA_CUSTOM_STATE_DIR=$mutable_bridge_state_dir"
  "DIA_CUSTOM_MODS_MANIFEST_PATH=$bridge_dir/config/dia-mods.json"
  "DIA_CUSTOM_CONFIG_PATH=$provider_config"
  "DIA_CUSTOM_MODEL_CATALOG_PATH=$model_catalog"
  "DIA_CUSTOM_TOOL_COVERAGE_PATH=$tool_coverage"
  "DIA_CUSTOM_MEMORY_PATH=$memory_database"
  "DIA_CUSTOM_MODS=$enabled_mods"
  "DIA_CUSTOM_RUNTIME_ID=$(/usr/libexec/PlistBuddy -c 'Print :DiaCustomBridgeRuntimeID' "$app/Contents/Info.plist")"
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
# A mature profile can spend several seconds indexing local history before the
# bridge begins listening. Keep launch fail-closed, but do not misreport that
# expected one-time/local indexing work as a startup failure.
for _ in {1..300}; do
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
  --disable-component-update
  --remote-debugging-port="$debug_port"
  --use-mock-keychain
  --no-first-run
  --disable-sync
)
dia_host_rules='MAP diabrowser.engineering ~NOTFOUND, MAP *.diabrowser.engineering ~NOTFOUND, MAP diabrowser.com ~NOTFOUND, MAP *.diabrowser.com ~NOTFOUND, MAP thebrowser.company ~NOTFOUND, MAP *.thebrowser.company ~NOTFOUND, MAP thebrowser.com ~NOTFOUND, MAP *.thebrowser.com ~NOTFOUND, MAP browserinternal.com ~NOTFOUND, MAP *.browserinternal.com ~NOTFOUND, MAP browserinternalstaging.com ~NOTFOUND, MAP *.browserinternalstaging.com ~NOTFOUND, MAP api.segment.io ~NOTFOUND, MAP cdn-settings.segment.com ~NOTFOUND, MAP clientstream.launchdarkly.com ~NOTFOUND, MAP mobile.launchdarkly.com ~NOTFOUND, MAP browser-intake-datadoghq.com ~NOTFOUND, MAP browser-intake-ap1-datadoghq.com ~NOTFOUND, MAP browser-intake-datadoghq.eu ~NOTFOUND, MAP browser-intake-us3-datadoghq.com ~NOTFOUND, MAP browser-intake-us5-datadoghq.com ~NOTFOUND, MAP o298668.ingest.us.sentry.io ~NOTFOUND, EXCLUDE localhost'
launch_args+=("--host-resolver-rules=$dia_host_rules")
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
