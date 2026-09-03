#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${project_dir:h}"
app="${1:-}"
snapshot="${2:-}"

if (( $# != 2 )) || [[ ! -d "$app" || ! -f "$snapshot/User Data/Local State" ]]; then
  print -u2 "usage: preflight-profile.sh /path/to/Dia\ Custom.app /path/to/profile.snapshot"
  exit 2
fi

test_root="$(/usr/bin/mktemp -d "$work_dir/Dia Custom RTTM.profile-preflight.XXXXXX")"
candidate="$test_root/profile"
browser_pid=""

stop_candidate() {
  if [[ -n "$browser_pid" ]] && /bin/kill -0 "$browser_pid" >/dev/null 2>&1; then
    browser_command="$(/bin/ps -o command= -p "$browser_pid" 2>/dev/null || true)"
    if [[ "$browser_command" == *"--user-data-dir=$candidate/User Data"* ]]; then
      /bin/kill -TERM "$browser_pid" >/dev/null 2>&1 || true
    fi
  fi
  for _ in {1..50}; do
    candidate_running=false
    while IFS= read -r candidate_pid; do
      [[ -z "$candidate_pid" ]] && continue
      candidate_command="$(/bin/ps -o command= -p "$candidate_pid" 2>/dev/null || true)"
      if [[ "$candidate_command" == *"--user-data-dir=$candidate/User Data"* ]]; then
        candidate_running=true
        /bin/kill -TERM "$candidate_pid" >/dev/null 2>&1 || true
      fi
    done < <(/usr/bin/pgrep -f -- "--user-data-dir=$candidate/User Data" 2>/dev/null || true)
    [[ "$candidate_running" == false ]] && break
    sleep 0.1
  done
  browser_pid=""
}

cleanup() {
  stop_candidate
  if [[ "$test_root" == "$work_dir"/Dia\ Custom\ RTTM.profile-preflight.* &&
        -d "$test_root" ]]; then
    /bin/rm -rf "$test_root"
  fi
}
trap cleanup EXIT INT TERM

/bin/cp -cR "$snapshot" "$candidate"
/bin/chmod 700 "$candidate"
mkdir -p "$candidate/Diagnostics"
/bin/chmod 700 "$candidate/Diagnostics"

start_candidate() {
  debug_port="$(node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
  ')"
  DIA_CUSTOM_PROFILE="$candidate" \
  "$app/Contents/MacOS/Dia" \
    -customApplicationDataBaseURLPath "$candidate" \
    --user-data-dir="$candidate/User Data" \
    --remote-debugging-port="$debug_port" \
    --use-mock-keychain \
    --no-first-run \
    --disable-sync \
    --disable-component-update \
    --disable-background-networking \
    --window-position=-10000,-10000 \
    --window-size=320,240 \
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost" \
    >>"$candidate/Diagnostics/profile-preflight.log" 2>&1 &
  browser_pid=$!

  ready=false
  for _ in {1..150}; do
    if /usr/bin/curl --silent --fail --max-time 1 \
        "http://127.0.0.1:$debug_port/json/list" \
        > "$candidate/Diagnostics/profile-preflight-targets.json" 2>/dev/null; then
      ready=true
      break
    fi
    /bin/kill -0 "$browser_pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  if [[ "$ready" != true ]]; then
    print -u2 "The staged app could not open the isolated profile preflight."
    return 1
  fi
  /bin/chmod 600 "$candidate/Diagnostics/profile-preflight-targets.json"
}

# A protected-preference migration can be stamped on one shutdown and rejected
# only by the following startup. Exercise both launches before the staged app is
# allowed near the live profile. No request can leave the machine because DNS
# and background network activity are disabled for both processes.
for launch_number in 1 2; do
  start_candidate
  sleep "${DIA_CUSTOM_PREFLIGHT_SETTLE_SECONDS:-5}"
  node "$script_dir/profile-integrity.js" assert-compatible "$snapshot" "$candidate" \
    >/dev/null
  stop_candidate
done

print "Profile preflight retained extensions, open sessions, and pinned-tab data."
