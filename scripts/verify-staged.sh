#!/bin/zsh
set -euo pipefail

app="${1:?usage: verify-staged.sh /path/to/DiaCustom.app comma,separated,mods}"
script_dir="${0:A:h}"
enabled_mods="${2:-}"
info="$app/Contents/Info.plist"

mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}

[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info")" == "local.rttm.dia" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$info")" == "http" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:1' "$info")" == "https" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUEnableAutomaticChecks' "$info")" == "false" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :SUAutomaticallyUpdate' "$info")" == "false" ]]
/usr/bin/codesign --verify --deep --strict "$app"
"$app/Contents/Helpers/DiaCustomNode" -e 'import("node:sqlite")' >/dev/null
# Validate the actual patched candidate with the same guard used at launch.
# Do this before starting its bridge or allowing an installation transaction.
node "$script_dir/check-dia-build.js" "$app" \
  --mods "$enabled_mods" --allow-structural --require-patched >/dev/null

if mod_enabled local-ai-routing; then
  /usr/bin/grep -a -q 'http://localhost:8765/ai-service-local-v1' "$app/Contents/MacOS/Dia"
  /usr/bin/grep -a -q 'GATEWAY_PORT=8765' \
    "$app/Contents/Resources/agent-server-resources/dist/handler"
fi
if mod_enabled reports; then
  node "${0:A:h:h}/src/patches/patch-report-controller.js" --check "$app" >/dev/null
  node "${0:A:h:h}/src/patches/patch-report-upload.js" --check "$app" >/dev/null
fi
if mod_enabled native-apps; then
  /usr/bin/grep -a -q 'AppsPreferencePaneView' "$app/Contents/MacOS/Dia"
fi
if mod_enabled morning-brief; then
  /usr/bin/grep -a -q 'MorningBriefScheduleClient' "$app/Contents/MacOS/Dia"
  /usr/bin/grep -a -q 'openOrGenerateCliaReport' "$app/Contents/MacOS/Dia"
fi

temporary_profile="$(/usr/bin/mktemp -d -t dia-custom-staged-health)"
port="$(node -e 'const n=require("node:net").createServer();n.listen(0,"127.0.0.1",()=>{process.stdout.write(String(n.address().port));n.close()})')"
bridge_log="$temporary_profile/bridge.log"
runtime_id="$(/usr/libexec/PlistBuddy -c 'Print :DiaCustomBridgeRuntimeID' "$info")"
DIA_CUSTOM_BRIDGE_PORT="$port" \
DIA_CUSTOM_RUNTIME_ID="$runtime_id" \
DIA_CUSTOM_PROFILE="$temporary_profile" \
DIA_CUSTOM_STATE_DIR="$temporary_profile/state" \
DIA_CUSTOM_MODS="$enabled_mods" \
DIA_CUSTOM_APPLE_MODEL_HELPER="$app/Contents/Helpers/DiaCustomAppleModel" \
  "$app/Contents/Helpers/DiaCustomNode" \
  "$app/Contents/Resources/DiaCustomBridge/src/server.js" \
  >"$bridge_log" 2>&1 &
bridge_pid=$!
cleanup() {
  /bin/kill "$bridge_pid" >/dev/null 2>&1 || true
  /bin/rm -rf "$temporary_profile"
}
trap cleanup EXIT
for _ in {1..60}; do
  health="$(/usr/bin/curl --silent --fail --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
  [[ -n "$health" ]] && break
  sleep 0.1
done
if [[ -z "${health:-}" ]]; then
  print -u2 "Staged bridge failed its health check:"
  /usr/bin/tail -40 "$bridge_log" >&2
  exit 1
fi
print -r -- "$health" | node "$script_dir/bridge-runtime.js" check-health \
  "$runtime_id" "$temporary_profile" "$enabled_mods"
