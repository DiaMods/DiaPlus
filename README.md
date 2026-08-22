# Dia Custom

Dia Custom routes the native chat UI through a localhost provider bridge. The current
default is `gpt-5.6-luna`, while `DIA_CUSTOM_CODEX_MODEL` can override it without
rebuilding the browser.

Run `./enable-dia-codex.sh`, then restart Dia. To revert, run
`./disable-dia-codex.sh` and restart Dia.

`build-dia-custom.sh` creates a separate, ad-hoc-signed `Dia Custom.app` for local
interoperability work. It uses the bundle ID `local.rttm.dia`, removes URL and
document-handler registration, and points Dia's private application-data override at
an isolated test profile. The original `/Applications/Dia.app` is not modified.

The clone is intentionally a test build: it has library validation disabled so a
local request bridge can be injected while the native Dia UI remains intact.

The bridge is provider-neutral. Codex is the first backend, but other local or hosted
providers can be added later without renaming or rebuilding the browser shell. Codex
reasoning summaries are mapped into Dia's native thinking stream; raw hidden
chain-of-thought is never exposed.
