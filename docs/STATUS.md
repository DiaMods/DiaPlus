# Status

Last audited against Dia 1.46.0, build 85823, on 2026-08-23. Build 85660 remains in the guarded patch table.

## Verified on this Mac

- The separately signed clone uses **local.rttm.dia**, an isolated profile, an isolated Keychain label, and does not alter official Dia.
- Anonymous local setup survives relaunch without a Dia account. The Account pane's stub identity is a local dependency object, not a Dia sync account.
- Native New Chat reaches **codex:gpt-5.6-luna** through the deployed bridge. A complete Luna text stream, reasoning stream, and typed native tool call passed end to end.
- Codex Luna/Terra/Sol, Apple on-device/PCC, OpenAI Responses, Ollama, and custom OpenAI-compatible provider adapters are implemented. Apple availability and generation passed locally; OpenAI/Ollama protocol behavior passes fixtures.
- The model catalog, Developer menu, and best-effort native toolbar picker are installed. The current build's hidden Prompt Tools constructor/presenter are discovered by guarded instruction shape instead of stale fixed offsets. Provider keys are stored separately with mode 0600 and are never returned by the settings API or exposed to the Codex subprocess.
- Native tool schemas are passed through dynamically. ToolSearch-loaded tools work without a fixed allowlist; the persistent inventory distinguishes native, local override, on-demand, and blocked routes.
- Local replacements cover public web search/fetch, imported people lookup, and memory. Dia product-knowledge tools are suppressed so they cannot restore a Dia-service dependency.
- Local memory imports isolated-profile history and native page results, captures chat turns, performs hybrid FTS/on-device semantic search, and supports retention, export, and deletion.
- Local connector imports, search/query tools, people lookup, and settings UI work with owner-controlled JSON exports.
- Dia's real artifact/report skills and sandboxed file tools reach the selected provider. Report calls are bound to the active context and gated for path traversal, symlinks, size, file count, and outbound URLs.
- The native build-85823 uploader's duplicate official-profile registry check is patched. The native tool-safety event carries the exact upload tool ID, and the patched branch targets Dia's unchanged Reports-library continuation.
- Chromium and Dia's per-agent filesystem sandboxes remain enabled. The Codex decision subprocess is additionally confined to an empty read-only workspace with its own action/network facilities disabled.
- Normal browsing and chosen providers remain available. Runtime logs show Segment/LaunchDarkly/Dia telemetry attempts blocked or redirected locally, with no allowed Dia-owned host in the current run.
- Automatic updates are disabled only for the clone. Rebuild-from-official-Dia is transactional and preserves the bridge state.
- The native app and helper signatures verify. The automated suite covers Node behavior, native patch layouts, Mach-O field parsing, shell/JavaScript syntax, Swift/Objective-C compilation, and signing.

Run **./dia-custom test** for the full suite and **./dia-custom doctor** for the installed runtime.

## Previously verified in an unlocked UI

- New Chat renders Luna responses without a Dia AI/account request.
- Native `open_tabs` and `read_tabs` tool round trips worked.
- Dia's activity surface rendered local-provider thinking summaries.
- New Chat flags and anonymous onboarding stopped the repeated-setup crash cycle.

## One unlocked UI verification remains

The Mac was locked for the latest native Report and picker work, so two visible outcomes are deliberately not claimed yet:

1. Click the injected toolbar picker and View → Developer → AI Model entries, switch between Luna and Apple, and open Prompt Tools & Model Routing once.
2. Ask for a new Report and confirm the patched native `upload_artifact` result appears in Dia's Reports library.

The Report's official prompt, native sandbox creation, strict local authorization, safety event, and uploader branch are all verified independently. This final step tests the AppKit/Reports database presentation after native ingestion.

## Remaining product work

- **Live account connectors:** implement explicit user-authorized OAuth adapters and incremental sync for Gmail, Calendar, Slack, Notion, Drive, and similar services. Today's connector layer indexes exports only; it does not reuse the real Dia app's account or credentials.
- **Authenticated browser fetch:** the public fetch override has no access to Chromium cookies. Signed-in page content should continue through native tab-reading context until a cookie-safe local browser-session adapter exists.
- **Future Dia builds:** endpoint, handler, Report, Prompt Tools, and UI integration points are signature/runtime discovered. The anonymous account gate still contains a small build-specific ARM64 table, so unknown builds intentionally fail closed pending audit.
- **Incremental final-text streaming:** reasoning is displayed while providers run, but the bridge buffers a provider's final decision before emitting the final Dia text/tool block. This is required for Codex/Apple structured decisions today and can be optimized independently for OpenAI-compatible streams.

## Account boundary

The Account and Advanced Chat panes cannot become real sync merely by changing feature flags. Model identity and service identity remain separate: future OAuth content belongs in the local connector/memory layer, while inference continues through the selected user-controlled provider. No official-Dia account token is copied, decrypted, or synthesized.
