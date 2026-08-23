# Dia Custom

Dia Custom keeps Dia's native browser and New Chat UI while routing AI through providers the user controls. It is a separate app with bundle ID **local.rttm.dia**; **/Applications/Dia.app** and its profile remain untouched.

The default is **gpt-5.6-luna** through the existing Codex login. The native chat can also use:

- Codex Luna, Terra, or Sol;
- Apple Foundation Models on-device or through Private Cloud Compute;
- Ollama models discovered at **127.0.0.1:11434**;
- OpenAI's Responses API;
- custom OpenAI-compatible Responses or Chat Completions endpoints.

## Start here

~~~sh
./dia-custom doctor
./dia-custom launch
~~~

Choose a model from View → Developer → AI Model. Dia Custom also inserts a compact picker into the chat toolbar when the current Dia layout exposes its standard toolbar stack. Provider, credential, memory, connector, and tool settings are available at:

~~~sh
./dia-custom settings
~~~

The Developer menu also exposes Dia's hidden Prompt Tools & Model Routing panel, the browser developer tools, Agent Server dashboard, and log-level window. Private Prompt Tools entry points are discovered and structurally verified against the exact Dia binary during each build.

Useful commands:

~~~text
./dia-custom bridge             Start only the localhost bridge
./dia-custom models             Print the discovered model catalog
./dia-custom openai-key         Save or clear the OpenAI key privately
./dia-custom test               Run provider, tool, patch, and build checks
./dia-custom update             Rebuild from the latest audited /Applications/Dia.app
./dia-custom status             Print the exact verified/remaining status
~~~

## Browser tools and internet access

Dia still assembles browser context and runs its native harness. Schemas supplied by Dia are passed to the selected provider, and calls return through Dia's Anthropic-compatible tool stream. This preserves native tab reading, opening, closing, tab mentions, file/skill tools, calculation, attachments, and Report upload.

Server-dependent tools have local replacements:

- **search_web** and **fetch_web_content** use a bounded public-web client with redirect, DNS, private-network, and Dia-host checks;
- **list_recent_people** and **lookup_person** use user-imported local connector records;
- **memory_search** and **memory_query** search the private local index;
- Dia product-knowledge tools are intentionally unavailable because they require Dia's service.

The settings page records every eager and on-demand tool Dia exposes. It labels each route as native, local override, native on-demand, or blocked, so a future Dia update reveals its tool changes without a hard-coded allowlist.

## Memory and connectors

Local memory is an owner-only SQLite database containing:

- history from Dia Custom's isolated Chromium profile;
- page content returned by native tab tools;
- user and assistant chat turns;
- records explicitly imported from account exports.

Search combines FTS with Apple's on-device sentence embeddings when available. The settings page includes counts, JSON export, retention pruning, and deletion controls.

Connector JSON may be an array or `{ "records": [...] }`. Records can contain `id`, `title`/`name`/`subject`, `content`/`text`/`body`, `url`, `updatedAt`, `metadata`, and `kind: "person"`. Imports are local snapshots, not live account sync. OAuth adapters for services such as Gmail, Calendar, Slack, Notion, and Drive remain future work.

## Native Reports

Report requests retain Dia's original **artifact-generation** and **report-kit** prompts and its native `Skill`, `Read`, `Write`, `Edit`, `Bash`, and `upload_artifact` tools. Files are therefore created inside Dia's real per-context agent sandbox, not in the bridge or an unrelated temporary directory.

The clone patches the native uploader's duplicate official-profile registry check, which cannot recognize a separately bundled profile. Before allowing that call, the bridge requires the exact active context's `work/artifacts/<folder>` shape, a regular `index.html`, no symlinks, bounded files and bytes, and safe public outbound URLs. It then emits Dia's expected tool-safety event and hands the same call to the native Reports-library path.

The binary layout, context safety gate, and complete stream handoff are tested. The final visible registration in Dia's Reports library still needs one unlocked-UI run on build 85823; it is not represented as a separate local-file export.

## Network and sandbox boundary

Normal websites and explicitly selected providers remain reachable. Dia/The Browser Company AI, registry, telemetry, feature-flag, crash, and updater destinations are redirected locally, cancelled by the runtime hook, and covered by Chromium hostname rules. Dia-owned provider URLs are rejected in configuration.

Three distinct sandboxes remain enabled:

- Chromium's browser-process sandbox;
- Dia's per-agent filesystem sandbox, with localhost port 8765 admitted for the bridge;
- an empty read-only Codex decision workspace with Codex built-in shell, filesystem mutation, MCP, and web search disabled.

Browser internet access happens through native/local browser tools. Report files are written through Dia's sandboxed native tools. Disabling these sandboxes is neither required nor the Report fix.

The clone's updater is disabled. Let official Dia update normally, then run **./dia-custom update**. Rebuilds preserve provider state and fail closed if a build-specific account patch has not been audited or a private integration point changes shape. Builds 85660 and 85823 are currently supported on Apple silicon.

## Project map

| Path | Purpose |
| --- | --- |
| **dia-custom** | Single command-line entry point |
| **bridge/src/provider-manager.js** | Provider discovery, selection, local-tool loop, and coverage tracking |
| **bridge/src/providers/** | Codex, Apple, OpenAI Responses, and Chat Completions adapters |
| **bridge/src/local-tools/** | Memory, connector, and public-web implementations |
| **bridge/src/artifact-safety.js** | Active-context Report upload and outbound-network gate |
| **bridge/src/server.js** | Dia protocols, streaming, and local administration API |
| **src/bootstrap/** | Native picker, Developer menu, and service-host blocking |
| **src/patches/** | Guarded identity, endpoint, account, handler, and Report patches |
| **scripts/** | Build, install, launch, update, doctor, and test workflows |
| **research/** | Build-analysis tools and notes; never runtime code |

See [Architecture](docs/ARCHITECTURE.md) and [Status](docs/STATUS.md) for exact boundaries.

## Runtime locations

- App: **../Dia Custom RTTM.app**
- Profile: **~/Library/Application Support/Dia Custom RTTM**
- Deployed bridge: **~/Library/Application Support/Dia Custom RTTM/Bridge**
- Provider config: **Bridge/.state/config.json**
- Provider credentials: **Bridge/.state/credentials.json**
- Model/tool catalogs: **Bridge/.state/models.json**, **Bridge/.state/tool-coverage.json**
- Local memory: **Bridge/.state/memory.sqlite3**
- Diagnostics: **~/Library/Application Support/Dia Custom RTTM/Diagnostics**
