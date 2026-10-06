# Dia Mods

`bridge/config/dia-mods.json` is the source of truth for mod IDs, defaults, scopes, safety requirements, and rebuild behavior. Profile overrides live in `Bridge/.state/mods.json`; generated state is not committed. Existing `modules.json` state is read as a one-way migration fallback.

| Mod | Primary implementation | Verification / failure boundary |
| --- | --- | --- |
| `identity-isolation` | `scripts/build.sh`, `patch-keychain-label.js`, entitlements | Bundle/profile/Keychain/signature checks in `doctor`; required |
| `network-isolation` | `patch-endpoint.js`, native URL hook, launch host rules, `network-policy.js` | Network-policy tests plus current-run destination log; required |
| `update-blocker` | `install.sh`, `update.sh`, `compatibility.js`, profile integrity guard | Sparkle/feed checks, full-profile snapshot, isolated first-launch preflight, staged swap, and paired app/profile rollback; required |
| `local-ai-routing` | `patch-endpoint.js`, `patch-agent-handler.js`, bridge server/providers | Protocol/provider tests and bridge health; required |
| `account-bypass` | `patch-no-account.js`, anonymous launch defaults | Per-build ARM64 layout check; clean rebuild to remove |
| `dia-import` | `prepare-dia-import.js`, `patch-dia-import.js`, native importer runtime hook | Owner-only sanitized staging; no account, password, cookie, Keychain, or service access |
| `model-picker` | native bootstrap model catalog/toolbar functions | Runtime-discovered toolbar plus View-menu fallback |
| `developer-tools` | native bootstrap, local routing/tool pages, browser inspector | Native inspector is webpage-only; local diagnostics fail closed |
| `mod-manager` | native Settings sidebar/content view, authenticated Mods API | Optional mods can be toggled; required safety/core mods remain locked |
| `native-memory` | native Memory reflection shim, `memory.js`, `provider-manager.js` | Memory derivation/profile/privacy/migration tests |
| `reports` | Report controller/uploader patches, `chat-shape.js`, `artifact-safety.js` | Structural patch checks and staged Report test suite |
| `local-web` | `local-tools/web.js`, `network-policy.js` | Public/private/Dia destination and parsing tests |
| `connectors` | `local-tools/connectors.js`, shared Memory index | Entry-type boundary and connector import/search tests |
| `native-apps` | native Apps state/callback shim, `apps-state.js` | Native view-model layout validation; disables itself on an incompatible shape |
| `live-connectors` | `connectors/registry.js`, native state observation, OAuth/MCP APIs | PKCE, one-use state, allowlist, discovery, execution, and secret-store tests |
| `morning-brief` | native Morning Brief feature gates/scheduler callback, `apps-state.js` | Profile exclusivity, daily idempotency, catch-up, and retry-state tests |
| `apple-models` | Swift helper and Apple provider adapter | Helper build/status/structured tool fixtures |
| `browser-use-tasks` | Research reference: native Browser Use & Tasks UI | Not a usable mod; default-off, activation blocked |
| `workspaces-spaces` | Research reference: native workspace/Spaces gates | Not a usable mod; default-off, activation blocked |
| `chat-controls` | Research reference: reasoning/personalization gates | Not a usable mod; default-off, activation blocked |
| `split-view-refinements` | Research reference: split toolbar/hover/drag gates | Not a usable mod; default-off, activation blocked |

## Commands

~~~sh
./dia-custom mods
./dia-custom mods list --json
./dia-custom mods disable <mod-id>
./dia-custom mods enable <mod-id>
./dia-custom compatibility /Applications/Dia.app
~~~

Runtime and bridge mods take effect after restarting Dia Custom. Build mods must be changed with `./dia-custom build --replace`; `install` refuses to claim that an already-applied binary patch was removed. Required safety/core mods cannot be disabled through this interface. The native Settings → Mods pane uses the same profile state and clearly marks restart/rebuild requirements.

## Updating for a new Dia release

1. Leave the existing clone installed and let only official Dia update.
2. Run `./dia-custom compatibility /Applications/Dia.app` to see every critical and optional result without changing either app.
3. Run `./dia-custom update`. Critical failures abort; optional failures require confirmation or `--allow-disable-incompatible`.
4. The updater verifies a staged clone, backs up the current app, swaps it, and rolls back automatically if live post-install verification fails.
5. Audit any unavailable Mod independently. It reactivates automatically when a later Dia build passes its validator.

This makes incompatibility explicit. A failed Report audit, for example, does not imply that Memory or the model picker needs to be rewritten.

## Research-only reference placeholders

As of October 6, 2026, these four entries are parked research references, **not real, usable mods**. They preserve information and isolated investigation tools in case we explicitly choose to develop these features later; they are not an active implementation roadmap or a promise of future support. `researchOnly: true` records this intent. The existing `availability: pending-audit` gate keeps them inactive and disables their toggles with an explicit reason; both the CLI and local Mods API reject activation. Stale saved preferences and forced bridge environment selections do not bypass that gate. Registering a flag is not evidence that its implementation works. These references do not re-enable Dia cloud services or change Codex's own browser-use feature settings.

All four groups were investigated independently in disposable profiles, with flags-off comparisons. Run `node research/tools/audit-browser-use-tasks.js /path/to/official/Dia.app` for reproducible static evidence: publisher verification, native flag/surface strings, source identity hashes and the shipped `browser_use` tool's sandbox contract. Build 87864 includes the native task access/execution types, but its old Home extension is only a compatibility stub with no entry point; do not try to restore that removed extension. This report deliberately sets `runtimeVerified` and `activationApproved` to false. If development resumes, native UI, local-provider dispatch, sandbox restrictions, confirmations, cancellation, disable/restart behavior and rollback must pass isolated testing before a mod becomes activatable. See `research/NATIVE-FEATURES-87864.md` for observed behavior and remaining failures. No release publication or live installation is implied by retaining this research.

`dia-import` repurposes Dia's bundled Arc importer as an official-Dia source. A guarded binary patch points that importer at an owner-only sanitized staging directory; a runtime hook supplies the Dia name and app icon. The staging builder retains browser profiles, bookmarks, history, favicons, extensions, and local tab/group data while excluding account state, cookies, passwords, sessions, chats, Memory, Reports, extension site data, and Keychain material. The native import view and callbacks remain Dia's.
