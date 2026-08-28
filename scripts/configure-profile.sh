#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
profile="${DIA_CUSTOM_PROFILE:-${HOME}/Library/Application Support/Dia Custom RTTM}"
enabled_mods="$(DIA_CUSTOM_PROFILE="$profile" node "$script_dir/mods.js" resolved)"
mod_enabled() {
  case ",${enabled_mods}," in
    *",${1},"*) return 0 ;;
    *) return 1 ;;
  esac
}

if mod_enabled account-bypass; then
  /usr/bin/defaults write local.rttm.dia onboardingForceCompleteFlowEnabled -bool false
  /usr/bin/defaults write local.rttm.dia hasPresentedOnboardingIntro -bool true
  /usr/bin/defaults write local.rttm.dia hasUserAuthenticated -bool true
  /usr/bin/defaults write local.rttm.dia onboardingRemainingSteps -array
fi
/usr/bin/defaults write local.rttm.dia customApplicationDataBaseURLPath "$profile"
/usr/bin/defaults write local.rttm.dia shouldShareUsageData -bool false
/usr/bin/defaults write local.rttm.dia firebaseSyncEnabled -bool false
/usr/bin/defaults write local.rttm.dia cloudKitSyncEnabled -bool false
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
