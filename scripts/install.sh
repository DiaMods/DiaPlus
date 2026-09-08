#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
app="${1:-${DIA_CUSTOM_APP:-/Applications/Dia Custom RTTM.app}}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"

if [[ ! -d "$app" ]]; then
  print -u2 "Dia Custom is not installed at $app. Run './dia-custom build' first."
  exit 1
fi
# Reject official/foreign bundles before snapshots, launchd changes, or any
# Info.plist edits. Individual binary patch guards run too late for this.
node "$script_dir/check-app-target.js" install "$app"
node "$script_dir/browser-process-guard.js" assert-stopped "$app"

# Direct refreshes stage a complete app and roll back automatically on failure.
# build.sh calls the inner installer only on its already disposable copy.
if [[ "${DIA_CUSTOM_SKIP_PROFILE_SNAPSHOT:-0}" != "1" ]]; then
  exec "$script_dir/refresh-install.sh" "$app"
fi

# Stop the runtime before snapshotting its profile databases or replacing code.
if [[ "${DIA_CUSTOM_STAGING:-0}" != "1" ]]; then
  /bin/launchctl remove local.rttm.dia.bridge >/dev/null 2>&1 || true
fi
node "$script_dir/bridge-runtime.js" stop "$app"

enabled_mods="${DIA_CUSTOM_EFFECTIVE_MODS:-$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved --app "$app")}"
enabled_build_mods="$(DIA_CUSTOM_PROFILE="$profile" DIA_CUSTOM_MODS="$enabled_mods" \
  node "$script_dir/mods.js" resolved --scope build)"
node "$script_dir/check-dia-build.js" "$app" --mods "$enabled_mods" --allow-structural
mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}

sign_identity="${DIA_CUSTOM_SIGN_IDENTITY:-}"
if [[ -z "$sign_identity" ]]; then
  sign_identity="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null | \
    /usr/bin/awk '/"Developer ID Application:/{print $2; exit}')"
fi
[[ -n "$sign_identity" ]] || sign_identity="-"

info="$app/Contents/Info.plist"
previous_mods="$(/usr/libexec/PlistBuddy -c 'Print :DiaCustomEnabledMods' "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c 'Print :DiaCustomEnabledModules' "$info" 2>/dev/null || true)"
for irreversible_mod in account-bypass dia-import reports apple-models; do
  if [[ ",$previous_mods," == *",$irreversible_mod,"* ]] && \
     ! mod_enabled "$irreversible_mod"; then
    print -u2 "$irreversible_mod is already patched into this app. Run './dia-custom build --replace' to disable it from a clean Dia copy."
    exit 1
  fi
done

# Sparkle runs in a helper process, outside the injected NSURLSession hook.
# Disable it in the clone itself and point any manual check at an empty local
# appcast served by the bridge. Official Dia remains free to update normally.
/usr/libexec/PlistBuddy -c "Set :SUEnableAutomaticChecks false" "$info"
/usr/libexec/PlistBuddy -c "Set :SUAutomaticallyUpdate false" "$info"
/usr/libexec/PlistBuddy -c "Set :SUScheduledCheckInterval 0" "$info"
/usr/libexec/PlistBuddy -c "Set :SUFeedURL http://127.0.0.1:8765/updates-disabled.xml" "$info"

bootstrap="$($script_dir/build-bootstrap.sh "$app")"
mod_enabled identity-isolation && \
  node "$project_dir/src/patches/patch-keychain-label.js" "$app"
mod_enabled local-ai-routing && \
  node "$project_dir/src/patches/patch-endpoint.js" "$app"
mod_enabled local-ai-routing && \
  node "$project_dir/src/patches/patch-no-account.js" \
    --capabilities-only "$app"
mod_enabled account-bypass && \
  node "$project_dir/src/patches/patch-no-account.js" \
    --anonymous-only "$app"
mod_enabled dia-import && \
  node "$project_dir/src/patches/patch-dia-import.js" "$app"
node "$project_dir/src/patches/embed-bootstrap.js" "$app" "$bootstrap"
mod_enabled local-ai-routing && \
  node "$project_dir/src/patches/patch-agent-handler.js" "$app"
if mod_enabled reports; then
  node "$project_dir/src/patches/patch-report-controller.js" "$app"
  node "$project_dir/src/patches/patch-report-upload.js" "$app"
fi

# Apple Foundation Models are optional at runtime, but when the current SDK is
# installed we embed a small signed helper in the clone. Keeping this outside
# Dia's executable makes the provider independent of Dia's private ABI.
apple_helper_target="$app/Contents/Helpers/DiaCustomAppleModel"
if mod_enabled apple-models; then
  if apple_helper="$($script_dir/build-apple-model-helper.sh)"; then
    mkdir -p "${apple_helper_target:h}"
    /usr/bin/ditto "$apple_helper" "$apple_helper_target"
    /bin/chmod 755 "$apple_helper_target"
  else
    print -u2 "Apple Foundation Models helper was not built; other providers remain available."
  fi
fi

"$script_dir/bundle-runtime.sh" "$app"

/usr/libexec/PlistBuddy -c "Add :DiaCustomEnabledMods string '$enabled_mods'" "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :DiaCustomEnabledMods '$enabled_mods'" "$info"
/usr/libexec/PlistBuddy -c "Add :DiaCustomBuildMods string '$enabled_build_mods'" "$info" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :DiaCustomBuildMods '$enabled_build_mods'" "$info"

# Configure Finder launches as well as explicit command-line launches.
DIA_CUSTOM_PROFILE="$profile" DIA_CUSTOM_MODS="$enabled_mods" "$script_dir/configure-profile.sh"

# A certificate-backed designated requirement stays stable across rebuilds, so
# macOS can retain the user's TCC and Keychain decisions.
clone_entitlements="$project_dir/src/config/clone-entitlements.plist"

# Sign the modified nested executable first, then seal the complete clone.
codesign --force --sign "$sign_identity" \
  --entitlements "$project_dir/src/config/agent-runtime-entitlements.plist" \
  "$app/Contents/Resources/agent-server-resources/dist/handler"
codesign --force --deep --sign "$sign_identity" \
  --entitlements "$clone_entitlements" \
  "$app"
codesign --verify --strict \
  "$app/Contents/Resources/agent-server-resources/dist/handler"
codesign --verify --deep --strict "$app"
"$app/Contents/Helpers/DiaCustomNode" -e 'import("node:sqlite")' >/dev/null

if [[ "$sign_identity" == "-" ]]; then
  print "Installed Dia Custom with an ad-hoc signature in $app"
else
  print "Installed Dia Custom with a stable certificate signature in $app"
fi
