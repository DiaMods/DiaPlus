# Status

Updated September 7, 2026. **Dia 1.48.0, build 86584, on Apple silicon** is supported by the guarded patch table and passes structural validation for all **20 default Mods**. Earlier build metadata remains recorded, but those candidates must pass the strengthened current checks before use; a historical audit does not bypass validation.

The full `./dia-custom test` run against official build 86584 passed: **218 bridge tests, 217 passed, one explicit Apple native-image runtime skip, zero failures**, plus native compilation/startup, structural patch, transaction, process-guard and profile checks. Signed update preparation and final installation passed. **The installed custom app passes `doctor`: “Dia Custom is ready.”** This document distinguishes completed checks from complete native UI parity.

## Implemented in this version

| Area | Current behavior |
| --- | --- |
| Native chat and tools | Dynamic native schemas and ToolSearch; local public-web, people and Memory tools; native tables, math, file tools and Reports |
| Provider output | Incremental final text across OpenAI-compatible, Codex and Apple adapters, with structured decision validation |
| Media | Image inputs, native PDF channels where supported, local PDF extraction, audio transcription and bounded video frame/speech extraction |
| Native dictation | Local raw-M4A transcription endpoint implementing Dia's `text_response` event stream |
| Connectors | Streamable HTTP, legacy HTTP+SSE and stdio MCP; OAuth discovery/registration where supported; generic CLI adapters; profile-specific incremental indexing |
| Spark | Version-aware 26-tool catalog for Spark 1.3.1, including attachments and authorized write actions; 11-tool read catalog on older versions |
| Knowledge and workflows | Profile-specific document library, provenance, manual research and explicitly enabled interval schedules using read-only tools |
| Morning Brief | Guarded native WindowController dispatch, once-daily profile state, catch-up/retry handling and ingestion-only success |
| Updates | Default-on optional custom updater alongside required stock-update blocker; verified preparation, staged installation and linked app/profile rollback |
| Launch and compatibility | Runtime/profile/Mod-aware bridge health; candidate content validation even under audited metadata; official-app and path-overlap guards |

The local settings page configures these integrations. Native **Settings → Mods**, **Memory** and **Apps** remain attached to their respective local integration state. Remote Mod distribution is deferred; the updater uses the local toolkit bundled inside the app.

## Focused verification completed

- Official build 86584's account/capability patch sites were relocated and checked against instruction context. Importer, Reports, endpoints, schemas and Morning Brief ABI checks pass. Original and patched endpoint layouts share the patcher's exact byte checks. A corrupted endpoint or Morning Brief prologue is rejected even when the executable retains an audited build number. Staged verification runs the full patched-app compatibility guard before bridge startup.
- In an isolated running 86584 app, the native `Window.WindowController.openOrGenerateCliaReport()` action executed successfully. The resolver selects the controller matching the active native window and verifies the exact method prologue before dispatch.
- Native startup tests pass for bridge runtime/profile/Mod identity, catalog readiness, delayed menu installation and custom updater routing. Stock updater suppression is gated correctly. Bootstrap builds pass with Morning Brief both enabled and omitted.
- The 86584 agent handler now patches its current permission, public-web, thinking and process-monitor sites. Five critical handler groups and both monitor sites require exact recognized layouts; installed candidates must have every required patch applied. Behavior fixtures preserve native tool context, question validation, artifact boundaries, file-URL/Bash restrictions and sandbox mode, and reject missing, corrupted or duplicated hooks without a partial write.
- Profile preflight exposed a pre-existing difference between explicit launches and Finder: a forced mock Keychain flag selected a different encryption key from the existing custom profile. Launch, bootstrap and preflight now preserve the established macOS Keychain key. Disposable copies opened twice under both builds retained all 17 user extensions, enabled, with unchanged preference-reset markers. Native and script regressions cover the launch policy; preference protection remains enabled.
- The in-app updater completed signed release verification and staged preparation using its bundled toolkit. The signed app was installed and refreshed successfully, with a paired app/profile rollback record retained. Its two-launch profile preflight retained extensions, open sessions and pinned-tab data. Failure and rollback behavior has fixture coverage; an actual failed-install restoration was not exercised on the user's profile.
- Connector protocol/lifecycle, credential isolation, OAuth discovery, process limits, cursor indexing, read-only research restrictions, schedule state and media/streaming behavior have focused tests. The real Spark connection previously passed a read-only account check; no real mail/calendar writes were performed.
- Local on-device speech transcribed synthetic audio. A Swift URLSession client sent raw M4A to the complete isolated bridge and decoded the native `text_response` SSE/EOF and legacy JSON responses. A foreign Origin was rejected. Native dictation's exact URL was separately verified by calling the official URL builder; its request/event layout was traced in the 86584 executable.
- In the live settings page, an imported synthetic source fed a manual run of a disabled automation, which succeeded and saved a readable research result. A different profile showed an empty library. No ongoing schedule was enabled.

The final installed `/Applications/Dia Custom RTTM.app` is signed build 86584. Finder launch passed runtime/profile identity and core readiness checks with all **20 compatible Mods**, **49 models** and **17 retained extension registrations**. All six native connector-schema cache routes returned HTTP 200. The final `doctor` run passed.

Native chat on installed build 86584 returned the requested “42”, and the native **Check for Updates** menu opened custom update settings showing build 86584 current on the official 1.48.0 feed. After the final handler refresh, native **ToolSearch** returned 14 tools, **open_tabs** displayed “Opened 1 tab”, and native tab/file reads produced the final answer **“The page title is Example Domain.”**

## Settings and native UI refresh

Dia Mod Settings now groups controls into seven accessible tabs and uses actual Personal/School profile names in synchronized dropdowns. Spark remains a connector preset, while the general introduction and empty state use neutral connector wording. Existing updater and section deep links remain compatible.

Connected MCP/CLI integrations restore their saved per-profile intent on startup. Transient failures retry without discarding that preference; explicit Disconnect remains off and missing authorization requires reconnect. A synthetic stdio connector was connected and tested through the new page, automatically restored after a real bridge-process restart, then explicitly disconnected and confirmed off after another restart. All seven tabs, cross-section profile switching, saved selection, and the installed page were checked in the browser.

Build 86584 added `isRebrandEnabled` and renamed `showParticlesLogo` to `showDiaIcon`, invalidating the previous Advanced Chat layout guard. The updated guard accepts the exact known layouts and preserves unrelated state. The installed app visibly displays the advanced new-tab logo and glow, and its runtime log confirms the new layout applied. Fresh Dock menus now receive the same window-item repair as the File menu. Native AppKit fixtures verify enabled window commands and their original dispatch; the installed app confirms its Dock hook is active. Direct Dock right-click verification was unavailable through desktop automation.

The refresh passed the full suite, two-launch profile preflight, signed installation and `doctor`. Its paired rollback record is `Dia Custom RTTM.pre-install.20260907-205527.3653.json`.

## Earlier native UI evidence

Prior installed builds verified anonymous relaunch, New Window/incognito commands, external URL registration, toolbar model selection, Codex/local-provider chat and native tab tool round trips. Public-web results rendered Dia's native search/read cards. Markdown tables and SwiftMath equations rendered in native views. A Report completed native Write/upload and opened from the Reports library; Memory enable/disable operated the local store. Repeated Developer ID signed launches retained a stable permission identity.

Those checks establish earlier working behavior; they have not all been repeated on the final 86584 installation.

## Remaining checks and limitations

- **Broader native UI regression:** Reports, Memory controls and the native migration UI still need a complete regression pass on this installation. Native write-confirmation flows and real failed-install restoration remain untested beyond fixtures.
- **Voice:** microphone capture through Dia's native UI remains untested end to end. Speech assets must be installed; file transcription and the protocol route are separate from microphone permission/capture checks.
- **Morning Brief:** native dispatch is verified; complete scheduled generation with connected sources and Reports ingestion still needs live verification.
- **Apple media:** the installed macOS 27 beta model can reject native image attachments with a guardrail error. The default uses labeled local Vision observations; explicit native-image mode remains available. Video uses sampled frames and available speech, not a continuous native video input channel.
- **Service integrations:** real third-party OAuth and write operations require their own accounts and authorization. Public dynamic registration is used only when advertised; otherwise a registered client ID is needed. Incremental indexing requires a compatible read-only changes tool.
- **Apple PCC:** unavailable without Apple's managed Private Cloud Compute entitlement.
- **Future builds:** every candidate must pass structural checks. Private Prompt Tools construction remains disabled because its production dependency context is unavailable. A future remote Mods repository is not implemented.

## Account and data boundary

Official account authentication and browser Sync are excluded. Anonymous mode uses a local dependency identity. Safe import omits tokens, cookies, passwords, Keychain items and other sensitive categories. Normal browsing and selected providers remain available while Dia service traffic is blocked or redirected locally. Chromium, native agent-file and restricted Codex decision sandboxes remain enabled.

See [Audit](AUDIT-2026-09-07.md), [Connectors](CONNECTORS.md) and [Local workflows](LOCAL-WORKFLOWS.md). Run `./dia-custom test` for the full suite and `./dia-custom doctor` for the installed runtime.
