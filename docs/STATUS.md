# Status

Last audited against Dia 1.46.0, build 85823. Build 85660 remains in the guarded rollback table.

## Verified headlessly on this Mac

- The installed clone is separately signed, uses **local.rttm.dia**, and keeps an isolated profile and Keychain label.
- The deployed bridge starts independently of the UI and defaults to **codex:gpt-5.6-luna**.
- Luna streamed final text and a typed native tool call through the complete deployed bridge.
- Apple Foundation Models compiled with Xcode 27. On-device and Private Cloud Compute both report available. On-device text and structured tool generation passed through the deployed bridge.
- OpenAI Responses and OpenAI-compatible Chat Completions adapters pass fixture tests for text, reasoning summaries, usage, and function calls.
- Ollama discovery, provider selection, blocked-Dia URL validation, catalog persistence, and local administration-token checks pass.
- Local memory imports profile history, indexes native page results and chats, executes a memory tool round locally, and returns the result to the selected model. Its directory, database, WAL, config, and catalog are owner-only.
- The native AppKit bootstrap and Apple helper compile; the complete app signature verifies.
- A locked-session runtime smoke test installed the Developer menu and inserted the AppKit model picker into Dia's live chat toolbar stack without crashing.
- The handler preserves Dia's native permission notification and the bridge emits a tool_safety_check_result whose ID exactly matches upload_artifact.
- The runtime network log recorded Dia telemetry and feature-flag attempts as BLOCKED; no Dia-owned destination was allowed.
- Automatic updates are disabled only in the clone. A guarded rebuild from the official app preserves bridge state.
- Nine automated Node tests plus patch-layout, shell-syntax, JavaScript-syntax, Swift, Objective-C, and signing checks pass.

Run **./dia-custom test** to repeat the headless suite and **./dia-custom doctor** to inspect the installed runtime.

## Previously verified in an unlocked Dia Custom UI

- New Chat reaches Luna without a Dia AI/account request.
- Dia exposed 11 native tools in the observed anonymous session: calculate, close_tabs, fetch_dia_product_knowledge, fetch_web_content, list_recent_people, lookup_person, open_tabs, read_tabs, search_dia_product_knowledge, search_web, and upload_artifact.
- Native open_tabs and read_tabs tool round trips worked.
- Dia's activity/thinking surface displayed provider reasoning summaries.
- The new-chat feature flags and anonymous onboarding path worked without repeated setup after the account fixes.

Every tool schema Dia includes in a turn is passed to the selected provider. The bridge does not maintain a fixed allowlist of those schemas.

## Needs the next unlocked UI check

1. Visually confirm the injected toolbar selector and View → Developer → AI Model fallback are usable.
2. Select Apple and Luna from the native menu and confirm the title/checkmark refresh.
3. Ask for a Report and confirm the new local safety handoff lets native upload_artifact ingest it and register it in Dia's Reports library.
4. Exercise close_tabs, tab mentions, web search/fetch, attachments, and multi-tool turns in the real UI.

The Mac was locked during this implementation, so these are explicitly not claimed as visual/native-ingestion verifications.

## Remaining engineering

- Account/service connectors: add explicit OAuth connections and local indexing for Gmail, Calendar, Slack, Notion, Drive, and similar services. Native account tools remain capability-gated; no real-Dia credentials are reused.
- Memory quality: add semantic embeddings, retention controls, delete/export UI, and an opt-in importer if Dia exposes a supported export format.
- Reports: after the unlocked ingestion check, add a regression fixture for the exact native tool-safety event shape.
- Provider UX: add forms above the existing JSON editor for custom endpoints and model aliases.
- Streaming latency: Codex and Apple structured decisions complete before final text/tool blocks stream; OpenAI/Ollama stream text and reasoning incrementally inside their adapters, but the bridge currently buffers the provider result before emitting Dia output blocks.
- Upgrade audit: add a layout for each future Dia build only after guarded instruction and host checks pass.

## Account and Advanced Chat boundary

The Account tab intentionally reflects the anonymous local dependency. It is not a sync account. Advanced Chat's account/app connection button cannot become a real connector merely by enabling a feature flag.

Future sync should be opt-in and independent of model routing: OAuth/service content enters a connector layer and local memory, while inference continues through the user's selected provider. This avoids restoring a hidden dependency on Dia's AI servers.
