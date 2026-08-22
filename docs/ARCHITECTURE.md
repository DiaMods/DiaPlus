# Architecture

## Chat and tool flow

1. Dia's native New Chat UI builds its ordinary Anthropic-compatible request, including browser context and the browser tools available for that turn.
2. The patched agent handler sends that request to `127.0.0.1:8765`.
3. `bridge/src/server.js` decrypts Dia's local request format, converts the conversation and tool schemas into a Codex task, and runs the configured Codex model.
4. Model reasoning summaries become Dia thinking blocks. They are activity summaries, not hidden chain-of-thought.
5. When Codex chooses a tool, the bridge returns a native Dia `tool_use` block. Dia performs the browser action and sends its `tool_result` back through the same loop.
6. The final answer is streamed back in Dia's native response format.

The model therefore does not automate Chromium directly. Dia remains responsible for tab context and native browser tools, which preserves its existing UI and permission surfaces.

## Network boundary

Regular website traffic is allowed. The clone is launched without the earlier process-wide macOS network sandbox.

AI, model-registry, diagnostics, and tool-cache URLs embedded in the current Dia executable are rewritten to localhost. The injected bootstrap also cancels native URL-session requests to known Dia, Segment, LaunchDarkly, and updater hosts. The current list is in `src/bootstrap/offline-bootstrap.c`.

Codex inference still reaches OpenAI through the locally installed Codex SDK and its existing authentication. No Dia account token is copied into the clone. This boundary is build-specific rather than a proof about all future Dia versions, so network behavior must be audited again after upgrades.

## Isolation

The custom app uses bundle identifier `local.rttm.dia`, the separate display name `Dia Custom RTTM`, a separate application profile, and a different Keychain service label. URL and document handler declarations are removed from the clone so it does not replace the real Dia as a registered handler.

Account-dependent chat gates are replaced by Dia's anonymous dependency path. Setup completion is stored only under the custom bundle identifier. Optional real-account sync is intentionally not implemented yet.

## Build layers

- `scripts/build.sh` clones the installed Dia app and changes clone identity.
- `src/patches/` redirects endpoints and removes current account/capability gates.
- `src/bootstrap/` builds `DiaCustomBootstrap.dylib`, which installs runtime overrides and service-host blocking.
- `scripts/install.sh` signs the nested handler, then signs the complete app clone.
- `scripts/launch.sh` deploys the bridge into Application Support, preserves its session state, starts it with `launchd`, and opens the isolated browser.

Patch safety checks are intentionally strict. Expected instructions, strings, and bundle location must match before a file is modified.
