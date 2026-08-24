# Dia Custom

Dia Custom keeps Dia's native browser and New Chat UI while routing AI through providers the user controls. It is a separate app with bundle ID **local.rttm.dia**; **/Applications/Dia.app** and its profile remain untouched.

The default is **gpt-5.6-luna** through the existing Codex login. The native chat can also use:

- Codex Luna, Terra, or Sol;
- Apple Foundation Models on-device;
- Apple Private Cloud Compute when the helper has Apple's managed PCC entitlement;
- Ollama models discovered at **127.0.0.1:11434**;
- OpenAI's Responses API;
- custom OpenAI-compatible Responses or Chat Completions endpoints.

## Start here

~~~sh
./dia-custom doctor
./dia-custom launch
~~~

Choose a model from View → Developer → AI Model. Dia Custom also inserts a compact picker into the chat toolbar: it remains before the attachment button in side chat and sits immediately before the microphone on New Tab. Provider, credential, memory, connector, and tool settings are available at:

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
./dia-custom update             Rebuild only from an audited /Applications/Dia.app
./dia-custom modules            List independently gated compatibility modules
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

Local Memory is an owner-only SQLite database containing:

- history from Dia Custom's isolated Chromium profile;
- page content returned by native tab tools;
- user and assistant chat turns;
- records explicitly imported from account exports.

Those sources are not themselves the final Memory product. Following [Dia's published Memory behavior](https://public.diabrowser.com/what-is-dia-memory), the selected user-controlled model infers durable plans, projects, preferences, interests, routines, facts, and relationships even when the user did not explicitly say “remember this.” Derived Memories retain source provenance, are recalled automatically into relevant chats, and remain isolated by Chromium profile. Incognito activity is never stored. Credential, medical, financial/payment, excluded-site, and known-sensitive-site content is filtered before storage and again before derivation.

Search combines FTS with Apple's on-device sentence embeddings when available. The settings page includes counts, JSON export, retention pruning, deletion controls, and host exclusions through Advanced JSON.

Dia's native **Settings → Memory** pane remains Dia's own view and view model. Dia Custom redirects its existing Enable, Disable, Reset, and per-profile retention actions to this local index, and changes only the inaccurate Dia-server sentence to say the activity is summarized using the selected model. Turning Memory off immediately removes memory tools, automatic recall, derivation, and future browsing/chat capture; it does not delete existing entries. Reset deletes browsing, chat, and derived Memories after confirmation while retaining imported connector records. No pane action contacts Dia. Use **./dia-custom settings** for export and granular deletion.

Memory storage and retrieval stay on this Mac. Derivation runs through the selected model: Apple on-device stays local, while Codex/OpenAI or another remote provider receives the filtered evidence needed for that derivation under that provider's own privacy boundary. It is never sent to Dia.

Connector JSON may be an array or `{ "records": [...] }`. Records can contain `id`, `title`/`name`/`subject`, `content`/`text`/`body`, `url`, `updatedAt`, `metadata`, and `kind: "person"`. Imports are local snapshots, not live account sync. OAuth adapters for services such as Gmail, Calendar, Slack, Notion, and Drive remain future work.

## Native Reports

Report requests retain Dia's original **artifact-generation** and **report-kit** prompts and its native `Skill`, `Read`, `Write`, `Edit`, `Bash`, and `upload_artifact` tools. Files are therefore created inside Dia's real per-context agent sandbox, not in the bridge or an unrelated temporary directory.

The bridge treats Report creation as a staged native workflow: it loads the two required skills, pins `Write` to a deterministic folder inside the exact active context, and withholds `upload_artifact` from the model until that write succeeds. Premature status messages and upload attempts are corrected internally; only then does the bridge submit the resulting `index.html` to Dia's uploader. This policy is enabled only when the native Report tools are present, keeping artifact title/icon/summary requests independent.

Anonymous Dia profiles normally skip construction of the native Artifacts controller, and the uploader also performs a duplicate official-profile registry check that cannot recognize a separately bundled profile. The clone structurally selects Dia's own controller-setup continuation and bypasses only that duplicate registry rejection. Before allowing an upload, the bridge still requires the exact active context's `work/artifacts/<folder>` shape, a regular `index.html`, no symlinks, bounded files and bytes, and safe public outbound URLs. It then emits Dia's expected tool-safety event and hands the same call to the native Reports-library path.

The binary layouts, live Artifacts controller, context safety gate, complete stream handoff, and visible native Report presentation are tested on build 85823. A generated Report is registered through Dia's artifact database and opens at Dia's sandboxed `chrome-untrusted://…dia-artifacts/` URL; it is not represented as a separate local-file export.

## Network and sandbox boundary

Normal websites and explicitly selected providers remain reachable. Dia/The Browser Company AI, registry, telemetry, feature-flag, crash, and updater destinations are redirected locally, cancelled by the runtime hook, and covered by Chromium hostname rules. Dia-owned provider URLs are rejected in configuration.

Three distinct sandboxes remain enabled:

- Chromium's browser-process sandbox;
- Dia's per-agent filesystem sandbox, with localhost port 8765 admitted for the bridge;
- an empty read-only Codex decision workspace with Codex built-in shell, filesystem mutation, MCP, and web search disabled.

Browser internet access happens through native/local browser tools. Report files are written through Dia's sandboxed native tools. Disabling these sandboxes is neither required nor the Report fix.

The clone's updater is disabled at the Sparkle preferences, feed, runtime-network, and Chromium-host layers. Let official Dia update normally, then run **./dia-custom update**. That command checks **src/config/supported-dia-builds.json before copying or replacing anything**; an unknown build leaves the working clone untouched. Rebuilds preserve provider state and also fail closed if a private integration point changes shape. Builds 85660 and 85823 are currently audited on Apple silicon.

## Compatibility modules

Every integration has a stable ID in **src/config/compatibility-modules.json**. Run:

~~~sh
./dia-custom modules
./dia-custom modules disable developer-tools
./dia-custom modules enable developer-tools
~~~

Runtime/bridge modules apply after a restart. Binary modules report that a clean **./dia-custom build --replace** is required, so disabling a Report or account patch never pretends to undo bytes in place. The current resolved build-module snapshot is sealed into the clone and checked by **doctor**. Safety/core modules—identity isolation, Dia-service network isolation, controlled updates, and localhost AI routing—are required and deliberately cannot be switched off through the normal module command.

When a Developer ID Application certificate is available, installs use it automatically so Dia Custom keeps one stable macOS code requirement across rebuilds. This prevents repeated Documents, microphone, and similar permission prompts caused by changing ad-hoc CDHashes. `DIA_CUSTOM_SIGN_IDENTITY=-` explicitly selects the portable ad-hoc fallback; that fallback can require permissions again after a rebuild. Chromium also uses its mock keychain and the clone's patched **Dia Custom Store** label, so it does not reuse official Dia's **Dia Safe Storage** item.

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
| **src/config/compatibility-modules.json** | Toggleable integration manifest and rebuild policy |
| **src/config/supported-dia-builds.json** | Audited Dia-build allowlist used before install/update |
| **scripts/** | Build, install, launch, update, doctor, and test workflows |
| **research/** | Build-analysis tools and notes; never runtime code |

See [Architecture](docs/ARCHITECTURE.md), [Compatibility modules](docs/MODULES.md), and [Status](docs/STATUS.md) for exact boundaries.

## Runtime locations

- App: **../Dia Custom RTTM.app**
- Profile: **~/Library/Application Support/Dia Custom RTTM**
- Deployed bridge: **~/Library/Application Support/Dia Custom RTTM/Bridge**
- Provider config: **Bridge/.state/config.json**
- Provider credentials: **Bridge/.state/credentials.json**
- Model/tool catalogs: **Bridge/.state/models.json**, **Bridge/.state/tool-coverage.json**
- Local memory: **Bridge/.state/memory.sqlite3**
- Diagnostics: **~/Library/Application Support/Dia Custom RTTM/Diagnostics**
