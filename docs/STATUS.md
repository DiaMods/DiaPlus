# Status

Last audited against Dia 1.45.0 (build 85660).

## Working now

- A separately named and signed `Dia Custom RTTM.app` with bundle ID `local.rttm.dia` and an isolated profile.
- Anonymous local setup without a Dia account, synthetic account identity, or repeated onboarding.
- Normal internet browsing while known native Dia service, telemetry, feature-flag, and updater requests are cancelled or redirected locally.
- Native New Chat routed to Codex, with `gpt-5.6-luna` as the default model.
- Dia's native thinking/activity UI populated from Codex reasoning summaries.
- Native tool round trips, including the verified `open_tabs` and `read_tabs` paths.
- Local permission decisions for the currently exposed read/search/open/close tool family. Common create/edit/delete/upload/send prefixes are denied.
- Local copies of the tool-cache responses required during startup.
- Guarded patching, ad-hoc code signing, isolated Keychain labeling, and a repeatable launch command.

## Remaining work

1. **Local memory:** replace Dia's account capability gate with a local memory store and re-enable `memory_query`/`memory_search` without contacting Dia.
2. **Provider and model selection:** connect Dia's hidden model-picker UI to local configuration, expose useful developer UI, and add a provider adapter for Ollama and future backends.
3. **Complete tool coverage:** test tab mentions, tab closing, search/navigation variants, attachments, and every tool schema that New Chat can expose. Add a local confirmation UI before permitting mutation tools.
4. **Performance and streaming:** stream more of the Codex response as it is produced and reduce the latency of structured tool decisions. Thinking status is immediate today, but final structured responses can still wait for a complete Codex turn.
5. **Optional account/sync design:** replace the anonymous dependency only when the user explicitly enables a real sync provider. Keep AI routing independent from that account.
6. **Upgrade resilience:** discover or signature-scan offsets, add fixtures/tests, and audit blocked hosts whenever Dia updates. The current patches are intentionally tied to build 85660.
7. **Network regression tests:** automate a clean-launch capture that proves normal website access and flags any non-local Dia service connection.

The Advanced Chat settings button and hidden developer/model flags are not yet a usable configuration surface. The launch script sets the known flags, but further account/capability wiring is required inside the native UI.
