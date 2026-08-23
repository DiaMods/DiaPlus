#!/bin/zsh
set -u

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
source_app="${DIA_CUSTOM_SOURCE_APP:-/Applications/Dia.app}"
app="${DIA_CUSTOM_APP:-$work_dir/Dia Custom RTTM.app}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
failures=0

pass() { print "ok    $1"; }
warn() { print "warn  $1"; }
fail() { print "FAIL  $1"; failures=$((failures + 1)); }

for dependency in node npm xcrun codesign; do
  if command -v "$dependency" >/dev/null; then pass "$dependency is available"; else fail "$dependency is missing"; fi
done
if command -v node >/dev/null && node -e 'import("node:sqlite")' >/dev/null 2>&1; then
  pass "Node.js supports the local SQLite memory store"
else
  fail "Node.js 22.5 or newer with node:sqlite is required"
fi

if [[ -d "$source_app" ]]; then
  source_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist" 2>/dev/null)"
  source_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$source_app/Contents/Info.plist" 2>/dev/null)"
  [[ "$source_id" == "company.thebrowser.dia" ]] && pass "original Dia bundle is untouched ($source_build)" || warn "unexpected original bundle id: $source_id"
  case "$source_build" in
    85660|85823) pass "installed Dia build is supported by the audited patch layouts" ;;
    *) warn "installed Dia build $source_build needs a new patch audit before rebuilding" ;;
  esac
else
  fail "original Dia is missing at $source_app"
fi

if [[ -d "$app" ]]; then
  custom_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null)"
  custom_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist" 2>/dev/null)"
  custom_update_checks="$(/usr/libexec/PlistBuddy -c 'Print :SUEnableAutomaticChecks' "$app/Contents/Info.plist" 2>/dev/null)"
  custom_auto_update="$(/usr/libexec/PlistBuddy -c 'Print :SUAutomaticallyUpdate' "$app/Contents/Info.plist" 2>/dev/null)"
  custom_update_interval="$(/usr/libexec/PlistBuddy -c 'Print :SUScheduledCheckInterval' "$app/Contents/Info.plist" 2>/dev/null)"
  custom_update_feed="$(/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$app/Contents/Info.plist" 2>/dev/null)"
  [[ "$custom_id" == "local.rttm.dia" ]] && pass "custom bundle id is local.rttm.dia" || fail "custom bundle id is $custom_id"
  [[ -z "${source_build:-}" || "$custom_build" == "$source_build" ]] && pass "custom build matches installed Dia ($custom_build)" || warn "custom build $custom_build differs from installed Dia ${source_build:-unknown}"
  case "$custom_build" in
    85660|85823) pass "custom build uses an audited patch layout" ;;
    *) fail "custom build $custom_build is not supported by the audited patch layouts" ;;
  esac
  [[ "$custom_update_checks" == "false" && "$custom_auto_update" == "false" && "$custom_update_interval" == "0" ]] && \
    pass "Sparkle automatic updates are disabled in the custom bundle" || \
    fail "Sparkle automatic updates are not fully disabled in the custom bundle"
  [[ "$custom_update_feed" == "http://127.0.0.1:8765/updates-disabled.xml" ]] && \
    pass "manual update checks are routed to the empty local appcast" || \
    fail "custom update feed is not local: $custom_update_feed"
  [[ -f "$app/Contents/Frameworks/DiaCustomBootstrap.dylib" ]] && pass "runtime bootstrap is embedded" || fail "runtime bootstrap is missing"
  [[ -x "$app/Contents/Helpers/DiaCustomAppleModel" ]] && pass "Apple Foundation Models helper is embedded" || warn "Apple Foundation Models helper is unavailable"
  if /usr/bin/grep -a -q "http://localhost:8765/ai-service-local-v1" "$app/Contents/MacOS/Dia"; then pass "AI endpoint is local"; else fail "local AI endpoint patch is missing"; fi
  if /usr/bin/grep -a -q 'GATEWAY_PORT=8765' "$app/Contents/Resources/agent-server-resources/dist/handler"; then
    pass "native per-context agent sandbox is enabled for the local bridge"
  else
    fail "agent sandbox gateway patch is missing"
  fi
  if node "$project_dir/src/patches/patch-report-upload.js" --check "$app" 2>/dev/null | /usr/bin/grep -q "already patched"; then
    pass "native Reports-library path is patched with the local safety gate"
  else
    fail "native Report upload patch is missing or incompatible"
  fi
  if node "$project_dir/src/patches/patch-report-controller.js" --check "$app" 2>/dev/null | /usr/bin/grep -q "already patched"; then
    pass "native Reports controller is enabled for the anonymous profile"
  else
    fail "native Reports controller patch is missing or incompatible"
  fi
  if /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1; then pass "custom app signature verifies"; else fail "custom app signature does not verify"; fi
  signature_authority="$(/usr/bin/codesign -dvv "$app" 2>&1 | /usr/bin/awk -F= '/^Authority=/{print $2; exit}')"
  if [[ "$signature_authority" == Developer\ ID\ Application:* ]]; then
    pass "certificate-backed app identity is stable across rebuilds"
  else
    warn "app is ad-hoc signed; rebuilds can invalidate macOS permission decisions"
  fi
else
  fail "Dia Custom is missing at $app"
fi

[[ -d "$profile" ]] && pass "isolated profile exists" || warn "profile will be created on first launch"
bridge_state="$profile/Bridge/.state"
if [[ -d "$bridge_state" ]]; then
  state_mode="$(/usr/bin/stat -f '%Lp' "$bridge_state" 2>/dev/null)"
  [[ "$state_mode" == "700" ]] && pass "local bridge state directory is owner-only" || \
    fail "local bridge state directory permissions are $state_mode, expected 700"
  sensitive_permissions_ok=true
  for state_file in config.json credentials.json memory.sqlite3 memory.sqlite3-shm memory.sqlite3-wal models.json sessions.json tool-coverage.json; do
    state_path="$bridge_state/$state_file"
    [[ ! -e "$state_path" ]] || [[ "$(/usr/bin/stat -f '%Lp' "$state_path" 2>/dev/null)" == "600" ]] || \
      sensitive_permissions_ok=false
  done
  [[ "$sensitive_permissions_ok" == true ]] && pass "provider, session, catalog, and memory files are owner-only" || \
    fail "one or more sensitive bridge-state files are not mode 600"
fi
if bridge_health="$(/usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:8765/health 2>/dev/null)"; then
  selected_model="$(print -r -- "$bridge_health" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).selectedModel||"unknown"))')"
  pass "local AI bridge is healthy ($selected_model)"
  if /usr/bin/curl --silent --fail --max-time 2 http://127.0.0.1:8765/api/models | \
      node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s);if(!Array.isArray(v.models)||v.models.length===0)process.exit(1)})'; then
    pass "provider model catalog is available"
  else
    fail "provider model catalog is unavailable"
  fi
else
  warn "local AI bridge is not running"
fi

if running_command="$(/bin/ps -axo command= | /usr/bin/grep -F "$app/Contents/MacOS/Dia" | /usr/bin/grep -v grep | /usr/bin/head -1)" && [[ -n "$running_command" ]]; then
  if [[ " $running_command " == *" --no-sandbox "* ]]; then
    warn "running browser predates sandbox hardening; restart Dia Custom"
  else
    pass "Chromium process sandbox is enabled"
  fi
  if [[ "$running_command" == *host-resolver-rules=* &&
        "$running_command" == *diabrowser.engineering* ]]; then
    pass "Chromium navigation also blocks Dia-owned hostnames"
  else
    warn "running browser predates the Chromium Dia-host DNS block; restart Dia Custom"
  fi
fi

if [[ -f "$profile/Diagnostics/network-requests.txt" ]] && \
    /usr/bin/grep -E 'ALLOW[[:space:]]+https?://([^/]*\.)?(diabrowser\.engineering|diabrowser\.com|thebrowser\.company|thebrowser\.com|browserinternal\.com|browserinternalstaging\.com|api\.segment\.io|cdn-settings\.segment\.com|clientstream\.launchdarkly\.com|mobile\.launchdarkly\.com|browser-intake[^/]*datadoghq[^/]*|o298668\.ingest\.us\.sentry\.io)' \
      "$profile/Diagnostics/network-requests.txt" >/dev/null 2>&1; then
  fail "network diagnostics show an allowed request to a Dia-owned service host"
else
  pass "no Dia-owned service request was allowed in the current network log"
fi

if (( failures > 0 )); then
  print "\n$failures required check(s) failed."
  exit 1
fi
print "\nDia Custom is ready."
