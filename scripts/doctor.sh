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

if [[ -d "$source_app" ]]; then
  source_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist" 2>/dev/null)"
  source_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$source_app/Contents/Info.plist" 2>/dev/null)"
  [[ "$source_id" == "company.thebrowser.dia" ]] && pass "original Dia bundle is untouched ($source_build)" || warn "unexpected original bundle id: $source_id"
else
  fail "original Dia is missing at $source_app"
fi

if [[ -d "$app" ]]; then
  custom_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null)"
  custom_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist" 2>/dev/null)"
  [[ "$custom_id" == "local.rttm.dia" ]] && pass "custom bundle id is local.rttm.dia" || fail "custom bundle id is $custom_id"
  [[ -z "${source_build:-}" || "$custom_build" == "$source_build" ]] && pass "custom build matches installed Dia ($custom_build)" || warn "custom build $custom_build differs from installed Dia ${source_build:-unknown}"
  [[ -f "$app/Contents/Frameworks/DiaCustomBootstrap.dylib" ]] && pass "runtime bootstrap is embedded" || fail "runtime bootstrap is missing"
  if /usr/bin/grep -a -q "http://localhost:8765/ai-service-local-v1" "$app/Contents/MacOS/Dia"; then pass "AI endpoint is local"; else fail "local AI endpoint patch is missing"; fi
  if /usr/bin/codesign --verify --deep --strict "$app" >/dev/null 2>&1; then pass "custom app signature verifies"; else fail "custom app signature does not verify"; fi
else
  fail "Dia Custom is missing at $app"
fi

[[ -d "$profile" ]] && pass "isolated profile exists" || warn "profile will be created on first launch"
if /usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:8765/health >/dev/null 2>&1; then pass "local AI bridge is healthy"; else warn "local AI bridge is not running"; fi

if (( failures > 0 )); then
  print "\n$failures required check(s) failed."
  exit 1
fi
print "\nDia Custom is ready."
