# Dia Custom

Dia Custom preserves Dia's native browser and New Chat UI while moving model routing, provider configuration, and personal memory into a localhost bridge. It is a separate app with bundle ID **local.rttm.dia**; **/Applications/Dia.app** remains untouched.

The default model is **gpt-5.6-luna**. The same native chat can now use:

- Codex: Luna, Terra, and Sol through the existing Codex login.
- Apple Foundation Models: on-device Apple Intelligence or Private Cloud Compute.
- Ollama: models are discovered automatically from **127.0.0.1:11434**.
- OpenAI Responses API: model discovery, streaming, reasoning summaries, and function tools.
- Custom OpenAI-compatible Responses or Chat Completions endpoints through the local provider configuration.

## Start here

~~~sh
./dia-custom doctor
./dia-custom launch
~~~

Use View → Developer → AI Model inside Dia Custom, or open the local provider page:

~~~sh
./dia-custom settings
~~~

A compact model selector is also inserted into Dia's chat toolbar when the current toolbar layout exposes its standard native stack. The Developer menu remains the fallback across UI changes.

Useful commands:

~~~text
./dia-custom bridge             Start the bridge without opening the browser
./dia-custom models             Print the live model catalog
./dia-custom openai-key         Configure an OpenAI key without writing it to disk
./dia-custom test               Run headless provider, memory, build, and patch checks
./dia-custom update             Rebuild from the latest audited /Applications/Dia.app
~~~

## Tools, memory, and Reports

Dia still builds browser context and executes native browser tools. Every provider sees the tool schemas supplied for that turn, and tool calls are returned to Dia in its native Anthropic-compatible stream. This keeps tab reads, tab opens/closes, browsing, web search, attachments, and report upload inside Dia's existing UI and confirmation flow.

Two local memory tools are added before a request reaches the selected model. They search an owner-only SQLite database containing:

- browsing history from Dia Custom's isolated Chromium profile;
- page content returned by native tab tools;
- future user and assistant chat turns.

Memory calls execute inside the bridge and never go to Dia. Native browser calls continue back to Dia. Existing encrypted Dia memory databases are not copied or bypassed.

Report generation continues to use Dia's own report prompts and **upload_artifact** path, so successful reports belong in Dia's Reports library. The local stream now supplies Dia's tool-safety event and preserves the native permission notification while approving it locally. That last native Reports-library registration path still needs an unlocked UI verification on build 85823.

## Network boundary

Normal websites and chosen model providers remain reachable. Known Dia, The Browser Company, model-registry, telemetry, feature-flag, and updater destinations are redirected to localhost or cancelled by the clone's runtime hook. The provider configuration also refuses Dia-owned endpoint URLs.

The custom clone's updater is disabled. Let the official Dia app update normally, then run **./dia-custom update**. Rebuilds are transactional: the old clone is preserved, and unknown Dia builds fail closed until their small build-specific account patch has been audited. Provider configuration and local memory live outside the app bundle, so they survive rebuilds.

Current audited Dia builds are 85660 and 85823 on Apple silicon.

## Project map

| Path | Purpose |
| --- | --- |
| **dia-custom** | Single command-line entry point |
| **bridge/src/provider-manager.js** | Provider registry, discovery, selection, and local-tool loop |
| **bridge/src/providers/** | Codex, Apple, OpenAI Responses, and Chat Completions adapters |
| **bridge/src/local-tools/** | Owner-only local memory tools and importers |
| **bridge/src/server.js** | Dia protocol, encrypted legacy proxy, streaming, and local admin API |
| **src/apple-model-helper/** | Small Swift Foundation Models executable |
| **src/bootstrap/** | Native model UI, developer menu, and service-host blocking |
| **src/patches/** | Guarded endpoint, identity, account, and handler patchers |
| **scripts/** | Build, install, launch, update, doctor, and test workflows |
| **research/** | Build-specific reverse-engineering notes; never runtime code |

See [Architecture](docs/ARCHITECTURE.md) and [Status](docs/STATUS.md) for exact boundaries and remaining UI checks.

## Runtime locations

- App: **../Dia Custom RTTM.app**
- Profile: **~/Library/Application Support/Dia Custom RTTM**
- Bridge and state: **~/Library/Application Support/Dia Custom RTTM/Bridge**
- Provider config: **Bridge/.state/config.json**
- Local memory: **Bridge/.state/memory.sqlite3**
- Diagnostics: **~/Library/Application Support/Dia Custom RTTM/Diagnostics**
