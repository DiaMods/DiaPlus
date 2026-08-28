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

The Developer menu opens Dia Custom's routing editor, model/tool dashboard, diagnostics folder, and Dia's native browser developer tools. Browser Developer Tools require a normal webpage because Dia disables its inspector on New Tab. Dia 1.46's private Prompt Tools window is intentionally not constructed: its production initializer requires an unavailable task-local dependency context and crashes when invoked with a synthetic one.

Useful commands:

~~~text
./dia-custom bridge             Start only the localhost bridge
./dia-custom models             Print the discovered model catalog
./dia-custom openai-key         Save or clear the OpenAI key privately
./dia-custom test               Run provider, tool, patch, and build checks
./dia-custom update             Rebuild only from an audited /Applications/Dia.app
./dia-custom mods               List or configure Dia Mods
./dia-custom migrate            Open native import from official Dia
./dia-custom status             Print the exact verified/remaining status
~~~

## Browser tools and internet access

Dia still assembles browser context and runs its native harness. Schemas supplied by Dia are passed to the selected provider, and calls return through Dia's Anthropic-compatible tool stream. Deferred browser tools are loaded through Dia's native `ToolSearch` handshake—even when a weaker local model tries to call one prematurely. This preserves native tab reading, opening, closing, tab mentions, file/skill tools, calculation, attachments, Report upload, and Dia's built-in step cards. Provider reasoning keeps its original token spacing, while action progress stays in Dia's Thought/tool UI instead of leaking into the final answer.

Server-dependent tools have local replacements:

- **search_web** and **fetch_web_content** notify Dia's original native presentation callback—rendering its “Searched the web” and “Read link” cards—but execute through a bounded localhost public-web client with redirect, DNS, private-network, and Dia-host checks. OpenAI-compatible local models receive both the standard tool-role result and an explicit completed-result continuation so weaker runtimes do not loop while waiting for data they already have;
- **list_recent_people** and **lookup_person** use user-imported local connector records;
- **memory_search** and **memory_query** search the private local index;
- Dia product-knowledge tools are intentionally unavailable because they require Dia's service.

The settings page records every eager and on-demand tool Dia exposes. It labels each route as native, local override, native on-demand, or blocked, so a future Dia update reveals its tool changes without a hard-coded allowlist.

Chat output retains Dia's native rich formatting. Standard Markdown tables render through Dia's table view. Math and science requests deterministically load Dia's own `latex-formatting` skill, then a narrow compatibility pass repairs common `$...$`, `$$...$$`, `\\(...\\)`, `\\[...\\]`, and fenced `latex` output from local models into Dia's required inline/block markers. Dia's bundled SwiftMath views still perform the rendering; the bridge does not draw replacement tables or equations.

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

Connector JSON may be an array or `{ "records": [...] }`. Records can contain `id`, `title`/`name`/`subject`, `content`/`text`/`body`, `url`, `updatedAt`, `metadata`, and `kind: "person"`.

Dia's native Apps pane is also locally enabled. Browser-session connectors—currently Gmail, Calendar, Drive, GitHub, Slack, Notion, LinkedIn, plus future native capabilities detected from Dia—keep authentication and cookies inside Chromium and return their tools through Dia's native progress UI. Direct third-party MCP connectors can be added by copying a manifest based on **examples/connectors/sample-mcp.json** into **Bridge/.state/connectors/** and restarting the bridge. Those adapters use explicit allowed domains, direct OAuth with PKCE/refresh/revocation, owner-only token storage, and namespaced generic tool presentation. Dia-owned authentication services remain blocked.

The native Apps layout owns the Advanced Chat, Profile, Morning Brief, and Connected Apps presentation; Dia Custom changes its real local view-model state rather than injecting replacement controls. Morning Brief uses Dia's bundled `clia-brief` agent and Report template with the selected model. It is exclusive to one profile, runs once per local day beginning at 5 AM, catches up on launch, retries an abandoned run, and lands in Dia's native Reports library.

## Native Reports

Report requests retain Dia's original **artifact-generation** and **report-kit** prompts and its native `Skill`, `Read`, `Write`, `Edit`, `Bash`, and `upload_artifact` tools. Files are therefore created inside Dia's real per-context agent sandbox, not in the bridge or an unrelated temporary directory.

The bridge treats Report creation as a staged native workflow: it loads the two required skills, pins `Write` to a deterministic folder inside the exact active context, and withholds `upload_artifact` from the model until that write succeeds. Follow-up edit requests reopen the completed workflow, read the existing HTML, write the complete revision back to the same artifact, and re-upload it before the model may claim completion. For OpenAI-compatible local/API providers, the native `Write` input streams to Dia as the model produces the HTML, restoring Report Kit's top-down live construction instead of waiting for the entire tool argument. If the model chooses Report Kit for a request that did not literally say “report,” the bridge adopts the native workflow and its safe artifact folder instead of losing coordination.

Premature status messages and upload attempts are corrected internally; a blank/root upload path follows Dia's contract and resolves to `index.html`. If a smaller model replaces the complete document with a body-only Report Kit fragment during a revision, the upload boundary restores Dia's required document shell and `style.css` link before native ingestion. A visual preflight rejects copied example tokens such as `IMAGE_URL`, missing bundled image files, ephemeral blob URLs, and canvases without matching initialization code. The model is directed to use accessible inline SVG for diagrams when it has no real image asset. The Report Kit's approved Chart.js dependency is copied into the artifact locally before upload, so rendering never needs the Dia-owned CDN. Only then does the bridge submit the report to Dia's uploader.

Anonymous Dia profiles normally skip construction of the native Artifacts controller, and the uploader also performs a duplicate official-profile registry check that cannot recognize a separately bundled profile. The clone structurally selects Dia's own controller-setup continuation and bypasses only that duplicate registry rejection. Before allowing an upload, the bridge still requires the exact active context's `work/artifacts/<folder>` shape, a regular `index.html`, no symlinks, bounded files and bytes, and safe public outbound URLs. It then emits Dia's expected tool-safety event and hands the same call to the native Reports-library path.

The binary layouts, live Artifacts controller, context safety gate, complete stream handoff, and visible native Report presentation are tested on build 86064. A generated Report is registered through Dia's artifact database and opens at Dia's sandboxed `chrome-untrusted://…dia-artifacts/` URL; it is not represented as a separate local-file export.

## Network and sandbox boundary

Normal websites and explicitly selected providers remain reachable. Dia/The Browser Company AI, registry, telemetry, feature-flag, crash, and updater destinations are redirected locally, cancelled by the runtime hook, and covered by Chromium hostname rules. Dia-owned provider URLs are rejected in configuration.

Three distinct sandboxes remain enabled:

- Chromium's browser-process sandbox;
- Dia's per-agent filesystem sandbox, with localhost port 8765 admitted for the bridge;
- an empty read-only Codex decision workspace with Codex built-in shell, filesystem mutation, MCP, and web search disabled.

Browser internet access happens through native/local browser tools. Report files are written through Dia's sandboxed native tools. Disabling these sandboxes is neither required nor the Report fix.

The clone's updater is disabled at the Sparkle preferences, feed, runtime-network, and Chromium-host layers. Let official Dia update normally, then run **./dia-custom update**. That command checks **src/config/supported-dia-builds.json before copying or replacing anything**; an unknown build leaves the working clone untouched. Rebuilds preserve provider state and also fail closed if a private integration point changes shape. Builds 85660, 85823, and 86064 are currently audited on Apple silicon. A newly released upstream build needs one compatibility audit in this project; once listed, the update itself remains a single command.

## Dia Mods

Every browser change is an independently gated Dia Mod with a stable ID in **bridge/config/dia-mods.json**. Optional mods can be configured from Dia's native **Settings → Mods** tab or from the command line:

~~~sh
./dia-custom mods
./dia-custom mods disable developer-tools
./dia-custom mods enable developer-tools
~~~

Runtime/bridge mods apply after a restart. Binary mods report that a clean **./dia-custom build --replace** is required, so disabling a Report or account patch never pretends to undo bytes in place. The current resolved build-mod snapshot is sealed into the clone and checked by **doctor**. Safety/core mods—identity isolation, Dia-service network isolation, controlled updates, and localhost AI routing—are required and deliberately cannot be switched off.

When a Developer ID Application certificate is available, installs use it automatically so Dia Custom keeps one stable macOS code requirement across rebuilds. This prevents repeated Documents, microphone, and similar permission prompts caused by changing ad-hoc CDHashes. `DIA_CUSTOM_SIGN_IDENTITY=-` explicitly selects the portable ad-hoc fallback; that fallback can require permissions again after a rebuild. Chromium also uses its mock keychain and the clone's patched **Dia Custom Store** label, so it does not reuse official Dia's **Dia Safe Storage** item.

### Import from official Dia

The `dia-import` Mod reuses Dia's native **Import from Another Browser** flow. It presents official Dia as a source and supports multiple browser profiles, bookmarks, history, extensions, favicons, and Dia's local pinned-tab/group database. On a fresh Dia Custom profile, the native importer is offered automatically; it can be reopened later with:

~~~sh
./dia-custom migrate
./dia-custom migrate status
~~~

The importer never reads official Dia's account tokens or Keychain. It makes an owner-only, Chromium-shaped staging copy containing only the selected safe browser data. Cookies, saved passwords, open sessions, extension site data, chats, Memory, Reports, and credentials are excluded. This keeps the apps independent and does not allow any Dia service traffic.

Official Dia Sync remains research-only because a modified bundle cannot retain Dia's official Apple code signature. Dia Custom will not impersonate that signature or send requests intended to appear as the official client; see **research/OFFICIAL-DIA-SYNC.md**.

## Project map

| Path | Purpose |
| --- | --- |
| **dia-custom** | Single command-line entry point |
| **bridge/src/provider-manager.js** | Provider discovery, selection, local-tool loop, and coverage tracking |
| **bridge/src/providers/** | Codex, Apple, OpenAI Responses, and Chat Completions adapters |
| **bridge/src/local-tools/** | Memory, connector, and public-web implementations |
| **bridge/src/connectors/** | Native-session and direct OAuth/MCP connector registry |
| **bridge/src/apps-state.js** | Native Apps and once-daily Morning Brief state |
| **bridge/src/artifact-safety.js** | Active-context Report upload and outbound-network gate |
| **bridge/src/server.js** | Dia protocols, streaming, and local administration API |
| **src/bootstrap/** | Native picker/import hooks, Developer menu, and service-host blocking |
| **src/patches/** | Guarded identity, endpoint, account, handler, and Report patches |
| **bridge/config/dia-mods.json** | Dia Mods manifest, defaults, scope, and rebuild policy |
| **src/config/supported-dia-builds.json** | Audited Dia-build allowlist used before install/update |
| **scripts/** | Build, install, launch, update, doctor, and test workflows |
| **research/** | Build-analysis tools and notes; never runtime code |

See [Architecture](docs/ARCHITECTURE.md), [Dia Mods](docs/MODS.md), and [Status](docs/STATUS.md) for exact boundaries.

## Runtime locations

- App: **../Dia Custom RTTM.app**
- Profile: **~/Library/Application Support/Dia Custom RTTM**
- Deployed bridge: **~/Library/Application Support/Dia Custom RTTM/Bridge**
- Provider config: **Bridge/.state/config.json**
- Provider credentials: **Bridge/.state/credentials.json**
- Model/tool catalogs: **Bridge/.state/models.json**, **Bridge/.state/tool-coverage.json**
- Local memory: **Bridge/.state/memory.sqlite3**
- Apps/Morning Brief state: **Bridge/.state/apps.json**
- Safe official-Dia import staging: **~/Library/Application Support/DiaImport**
- Custom connector manifests: **Bridge/.state/connectors/*.json**
- Diagnostics: **~/Library/Application Support/Dia Custom RTTM/Diagnostics**
