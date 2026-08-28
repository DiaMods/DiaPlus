#!/bin/zsh
set -euo pipefail

requested="${DIA_CUSTOM_SIGN_IDENTITY:-}"
identities="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null || true)"
if [[ -z "$requested" ]]; then
  identity_line="$(print -r -- "$identities" | /usr/bin/awk '/"Developer ID Application:/{print; exit}')"
else
  [[ "$requested" != "-" ]] || {
    print -u2 "Official Dia Sync requires a stable certificate-backed app signature."
    exit 1
  }
  identity_line="$(print -r -- "$identities" | /usr/bin/grep -F -- "$requested" | /usr/bin/head -1 || true)"
fi
[[ -n "$identity_line" ]] || {
  print -u2 "No matching certificate-backed code-signing identity is available."
  exit 1
}

identity_hash="$(print -r -- "$identity_line" | /usr/bin/awk '{print $2}')"
identity_name="$(print -r -- "$identity_line" | /usr/bin/sed -E 's/^[^"]*"([^"]+)".*$/\1/')"
certificate="$(/usr/bin/security find-certificate -c "$identity_name" -p 2>/dev/null || true)"
[[ -n "$certificate" ]] || {
  print -u2 "Could not load the certificate for $identity_name."
  exit 1
}
subject="$(print -r -- "$certificate" | /usr/bin/openssl x509 -noout -subject -nameopt RFC2253)"
team_id="$(print -r -- "${subject#subject=}" | /usr/bin/tr ',' '\n' | \
  /usr/bin/awk -F= '$1 == "OU" {print $2; exit}')"
print -r -- "$team_id" | /usr/bin/grep -Eq '^[A-Z0-9]{10}$' || {
  print -u2 "Could not determine a 10-character Team ID for $identity_name."
  exit 1
}

/usr/bin/printf '%s\t%s\t%s\n' "$identity_hash" "$team_id" "$identity_name"
