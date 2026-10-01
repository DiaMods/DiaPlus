#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
work_dir="${DIA_CUSTOM_WORK_DIR:-${project_dir:h}}"
app="${1:-}"
snapshot="${2:-}"

if (( $# < 1 || $# > 2 )) || [[ ! -d "$app" ]] || \
    [[ -n "$snapshot" && ! -f "$snapshot/User Data/Local State" ]]; then
  print -u2 "usage: preflight-profile.sh /path/to/Dia\ Custom.app [/path/to/profile.snapshot]"
  exit 2
fi
app="${app:A}"
[[ -z "$snapshot" ]] || snapshot="${snapshot:A}"
work_dir="${work_dir:A}"

test_root="$(/usr/bin/mktemp -d "$work_dir/Dia Custom RTTM.profile-preflight.XXXXXX")"
candidate="$test_root/profile"
browser_pid=""

stop_candidate() {
  node "$script_dir/browser-process-guard.js" stop-profile "$app" "$candidate" || return 1
  browser_pid=""
}

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  if ! stop_candidate; then
    print -u2 "Could not verify preflight shutdown; temporary profile preserved at $candidate"
    exit 1
  fi
  if [[ "$test_root" == "$work_dir"/Dia\ Custom\ RTTM.profile-preflight.* &&
        -d "$test_root" ]]; then
    /bin/rm -rf "$test_root"
  fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

node "$script_dir/browser-process-guard.js" assert-stopped "$app" "$candidate"
node "$script_dir/browser-process-guard.js" assert-no-other-custom "$app"
if [[ -n "$snapshot" ]]; then
  /bin/cp -cR "$snapshot" "$candidate"
else
  mkdir -p "$candidate"
fi
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
  ')" || return $?
  DIA_CUSTOM_PREFLIGHT=1 \
  DIA_CUSTOM_PROFILE="$candidate" \
  "$app/Contents/MacOS/Dia" \
    -customApplicationDataBaseURLPath "$candidate" \
    --user-data-dir="$candidate/User Data" \
    --remote-debugging-port="$debug_port" \
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
  /bin/chmod 600 "$candidate/Diagnostics/profile-preflight-targets.json" || return $?
}

# A protected-preference migration can be stamped on one shutdown and rejected
# only by the following startup. Exercise both launches before the staged app is
# allowed near the live profile. No request can leave the machine because DNS
# and background network activity are disabled for both processes.
for launch_number in 1 2; do
  start_candidate || exit $?
  # Readiness can precede a fatal async subscription by several seconds.
  # Exercise native startup and require the exact launched process to survive.
  sleep "${DIA_CUSTOM_PREFLIGHT_SETTLE_SECONDS:-20}"
  if ! /bin/kill -0 "$browser_pid" >/dev/null 2>&1 || \
      ! /usr/bin/curl --silent --fail --max-time 2 \
        "http://127.0.0.1:$debug_port/json/list" >/dev/null; then
    print -u2 "The staged browser exited during native startup (launch $launch_number)."
    /usr/bin/tail -30 "$candidate/Diagnostics/profile-preflight.log" >&2
    exit 1
  fi
  if [[ -n "$snapshot" ]]; then
    node "$script_dir/profile-integrity.js" assert-compatible "$snapshot" "$candidate" \
      >/dev/null
  fi
  stop_candidate || exit $?
done

if [[ -n "$snapshot" ]]; then
  print "Native startup passed twice; profile preflight retained extensions, open sessions, and pinned-tab data."
else
  print "Native startup passed twice with an isolated fresh profile."
fi
