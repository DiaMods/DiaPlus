# Architecture

## Runtime flow

1. Dia's native New Chat harness creates its normal system context, conversation, browser context, skills, and eager/on-demand tool set.
2. A guarded patch sends the harness's Anthropic-compatible model request to **127.0.0.1:8765** while leaving the harness itself intact.
3. **ProviderManager** resolves the persistent model selection, removes Dia-service-only tools, adds local tools, and records tool coverage.
4. The selected Codex, Apple, OpenAI Responses, or OpenAI-compatible Chat Completions adapter produces final text or typed tool calls.
5. Local calls execute inside the bridge and their results are appended for another model decision. Native calls stream back with the original name, ID, and arguments.
6. Dia executes native browser/file/skill/Report tools in its per-context harness and sends results through the next model turn. Deferred schemas use Dia's `ToolSearch`; premature calls from weaker models are converted into that loader step, then execute once Dia presents the real schema. Public `search_web`/`fetch_web_content` calls notify Dia's original presentation callback so its rich step cards remain native, while their actual implementation is redirected to the localhost bridge. Reasoning keeps provider token boundaries.
7. For math/science chat, the bridge loads Dia's native `latex-formatting` skill before provider output. A final-text compatibility pass converts common model math delimiters to the exact `{latex}` inline/fenced forms expected by Dia, which then renders them using its bundled SwiftMath item views. Markdown tables pass through unchanged to Dia's native table renderer.

The provider does not automate Chromium directly. Dia retains browser context, tab actions, attachments, sandboxed artifact creation, and Reports-library ownership.

## Provider boundary

Provider definitions and selection live in **Bridge/.state/config.json**. Secrets live separately in **Bridge/.state/credentials.json** or an explicitly configured environment variable. The sanitized picker catalog is **Bridge/.state/models.json**. These files are owner-only.

Adapters return one shared result contract:

- final text and optional usage;
- provider-authored reasoning summaries;
- zero or more typed calls using exact supplied tool names.

Codex runs as a decision engine in an empty read-only workspace. Its built-in command execution, file changes, MCP/apps, and web search are disabled; browser actions are expressed only through Dia Custom tools. Apple runs in a separate signed Swift helper using Foundation Models and NaturalLanguage. Its compact structured schema carries the selected native tool name plus JSON arguments while the complete Dia schemas stay in the decision prompt and native harness. On-device generation works without a network service; Private Cloud Compute additionally requires Apple's managed entitlement and is advertised as unavailable when the helper lacks it. OpenAI uses the Responses API. Ollama and custom servers use OpenAI-compatible Chat Completions or Responses endpoints. Chat Completions continuations retain the standard assistant/tool sequence and also mirror the bounded completed result into an explicit continuation message for local runtimes that otherwise ignore `role: tool` content.

The localhost administration API uses an unguessable token, sends no permissive CORS headers, and never returns credentials. The settings page receives that token only from the loopback origin that serves it.

## Native model UI

The runtime bootstrap first asks Dia for its hidden selector. If the current build does not instantiate one, it provides:

- an AppKit pop-up in the standard New Chat toolbar stack when that stack is discoverable;
- View → Developer → AI Model as a layout-independent fallback;
- Model Providers & Settings to open the loopback administration page.

Picker items come from the version-neutral model catalog. Toolbar discovery is best-effort so a future view-layout change cannot break chat routing.

## Tool routing

Eager tool schemas from Dia are normalized and passed through dynamically. Native ToolSearch reminders are also inventoried, but their schemas remain deferred until Dia's harness loads them. This preserves future native additions without pretending a deferred tool is already callable.

Routes currently fall into four groups:

- **native:** local browser/harness actions such as `open_tabs`, `read_tabs`, `close_tabs`, `calculate`, `Skill`, `Read`, `Write`, `Edit`, `Bash`, `ToolSearch`, and `upload_artifact`;
- **local override:** public web search/fetch, memory, connector search/query, and imported people lookup;
- **native on-demand:** schemas advertised by ToolSearch but not yet loaded for the turn;
- **blocked:** Dia product knowledge or another observed tool intentionally excluded because it depends on Dia's service.

The coverage store persists name, route, schema, schema hash, and first/last-seen timestamps. A local override with the same exact name replaces the native server-dependent definition.

If a provider asks for local and native actions in separate rounds, local results are resolved immediately and the same provider continues. Native calls return to Dia. An identical native call that already failed in the current user request is stopped rather than entering an automatic retry loop.

## Public web boundary

The local web client searches DuckDuckGo's public HTML endpoint and fetches public HTTP(S) text directly. It enforces request/redirect limits, bounded response bodies, supported content types, DNS resolution, and private/reserved IP rejection on every hop. Dia and The Browser Company hosts are always rejected.

This client does not receive Chromium cookies. Signed-in content stays behind Dia's browser-session clients; the native Apps view model supplies only sanitized connection state, account display text, and presented capabilities. Cookie values and browser tokens are never exported.

## Memory and connectors

The SQLite memory store imports:

- Chromium history from the isolated Dia Custom profile;
- URL, title, and page text found in native tool results;
- user and assistant chat turns;
- user-imported connector records.

FTS5 supplies lexical retrieval. Apple's on-device sentence embedding supplies lazy semantic vectors, which are stored as Float32 blobs and combined with lexical results. Retention and count limits are applied after history refresh; administration routes support statistics, export, scoped deletion, and pruning.

Raw browsing/chat entries are a short-lived evidence layer, not the user-facing semantic model. A queued background pass asks the currently selected user-controlled provider to infer zero or more durable Memories (facts, interests, plans, preferences, projects, relationships, and routines), stores their confidence and source links, and marks the evidence batch processed. Apple on-device performs this locally; a selected Codex/OpenAI-compatible remote provider receives the filtered evidence under that provider's boundary. No derivation uses Dia's service. Relevant derived Memories are retrieved automatically and appended as private context before the next provider decision; raw evidence is a fallback when no derived Memory matches.

Memory is scoped to the Chromium profile ID recovered from each agent context. Dia's native profile rows are mapped through Chromium's `Local State` name-to-directory table, so each native retention menu writes its own profile value. Navigation evidence follows that profile's retention period; derived Memories and chats persist until Reset or a count-bound prune. Incognito/off-the-record payloads are never captured. Known sensitive hosts, user-excluded hosts, credentials, medical material, and financial/payment material are rejected before capture and again before derivation.

The bootstrap does not recreate Settings UI. It reflects Dia's native `MemoryPreferencePaneViewModel` state, sends a copied state through its existing Combine subject, and retargets the native controls to authenticated loopback routes. As a result, Dia continues to own layout and future visual changes while the local bridge owns persistence and semantics.

Connector imports are transactionally replaced by connector ID and use the same index with source isolation. Local `connector_query` enforces the connector entry type even when given explicit URIs. People records supply local versions of Dia's recent-person and lookup-person tools.

The live connector registry has two adapter boundaries. `NativeSessionAdapter` leaves Gmail, Calendar, Drive, GitHub, Slack, Notion, LinkedIn, and future shipped browser-session tools in Dia's native harness; only connection metadata and presented capability names are mirrored locally. `BridgeConnectorAdapter` loads owner-installed JSON manifests and talks directly to standards-based MCP servers. Remote connectors require HTTPS, explicit allowed domains, and never accept Dia-owned destinations; loopback HTTP is permitted for local servers. OAuth uses PKCE, expiring one-use state, direct token refresh/revocation, and the owner-only credential file with redacted logs. Unknown connectors use namespaced generic tool names. When Memory is on, the relevant resulting chat summary enters the normal provenance-bearing conversation evidence; raw account responses and blanket account copies do not.

## Native Apps and Morning Brief

The bootstrap does not rebuild the Apps pane. It validates and copies Dia's shipped `AppsPreferencePaneViewModel.State`, then publishes the locally entitled Advanced Chat and Morning Brief values through the view model's existing Combine subject. The same mod validates `NewTabPageViewModel.State`, enables Dia's shipped particle logo, and disables the legacy clickable Personalization entry point while Advanced Chat is active. Dia continues to own its Profile, Morning Brief, Connected Apps, branded rows, and layout. The shipped Morning Brief callback is retained so Dia's per-profile preference and scheduler remain authoritative; the same click is mirrored to the authenticated loopback state. Native connector rows are reflected into sanitized local status records. If a future state layout or callback set no longer matches the audited labels and types, `native-apps` stops applying and records a compatibility diagnostic without disabling chat, Memory, or Reports.

Morning Brief retains Dia's bundled `clia-brief` agent, native schedule client, skills, paintings, HTML template, browser tools, and Reports ingestion. The selected custom provider receives its inference turns through the same localhost model route. `apps.json` mirrors the one enabled profile, the 5–11 AM local schedule, attempts, source diagnostics, and one success per local day. Dia's native scheduler owns windowing, launch catch-up, and Report delivery; the bridge recognizes the bundled agent request, marks its local run state, and records successful completion. An abandoned local run becomes retryable after 30 minutes. Connector failures remain model-visible tool results so the native agent can produce a partial brief rather than losing the entire report.

## Reports

Dia's original request already includes `artifact-generation`, `report-kit`, sandbox environment context, and native `Skill`, `Read`, `Write`, `Edit`, `Bash`, and `upload_artifact` schemas. Dia Custom preserves all of it. A provider therefore loads Dia's actual Report instructions, writes with native sandboxed tools under:

~~~text
User Data/Default/AgentServer/contexts/<context UUID>/work/artifacts/<report folder>
~~~

and then calls native `upload_artifact`. During the creation stage, the provider does not receive the upload schema. Dia Custom derives a deterministic report folder from an explicit Report request, normalizes native `Write` to that exact path, and advances to upload only after the matching tool result succeeds. When the model itself selects `report-kit` for a broader request, the coordinator adopts that committed native workflow and the successful safe artifact path chosen by Dia's tools. A provider that answers early or invents an unavailable tool is retried with `Write` as its sole available action.

OpenAI-compatible providers expose their streamed function arguments to the bridge. Once a Report `Write` begins its `content` field, the Anthropic-compatible response opens Dia's native tool block and forwards encoded HTML deltas top-down. The block remains open until the complete provider decision passes tool/path authorization; its final JSON delimiter and `content_block_stop` are emitted only then. Codex and Apple structured decisions retain their buffered path until their adapters expose equivalent safe argument streaming.

Official Dia normally tears down its Artifacts controller when the profile lacks a server-derived account capability, even though all local persistence dependencies exist. A structural patch selects Dia's original async setup continuation for the anonymous clone.

Dia also validates `site_root` against a registry associated with the official profile. That registry cannot recognize a separately bundled clone even when the path is correct. The second native Report patch semantically locates only this duplicate registry-error branch and sends it to the existing success continuation. Folder validation and native ingestion remain unchanged.

Before that patched branch is reachable, the bridge independently requires:

- a UUID matching the exact `<agent-context>` in the active model request;
- the fixed `work/artifacts/<safe folder>` structure;
- real directories and regular entry files with no path escape or symlink;
- at most 1,000 files and 50 MiB;
- at most 8 MiB of inspectable HTML/CSS/JS/JSON/SVG/XML;
- only resolvable public, non-Dia outbound HTTP(S) URLs.

Dia's native Report Kit defines a blank/root `relative_path` as the site's `index.html`; the bridge canonicalizes that value before the path checks. Before ingestion, a Report Kit-marked body fragment is reconstructed as a complete HTML document with Dia's required UTF-8/viewport metadata and `style.css` link. Its exact approved `artifactcdn.diabrowser.engineering` Chart.js reference is never requested: the bridge copies a pinned Chart.js bundle into `.dia-custom-libs/` and rewrites the artifact to that relative file before scanning outbound URLs. All other Dia-owned artifact URLs remain blocked.

The same preflight verifies that Report visuals are durable before native ingestion. Image and SVG-image references must be real public HTTP(S)/data sources or regular files contained in the Report folder; example sentinels such as `IMAGE_URL`, blob URLs, escaped paths, and missing assets fail closed. Canvas visuals require inline drawing or Chart initialization, including a reference to each named canvas. Provider policy prefers an accessible inline SVG when no real image asset exists.

The bridge then emits Dia's proprietary `tool_safety_check_result` with the same tool-use ID and approved outbound URL list. Dia's native permission controller is notified, while the patched handler resolves the unavailable proprietary Watchtower decision locally.

## Network boundary

The browser is not globally offline. User navigation, public web tools, and selected providers need network access. Dia Custom instead uses overlapping destination controls:

- known AI, registry, tool-cache, telemetry, and crash endpoints are rewritten to loopback;
- the injected NSURLSession resume hook cancels Dia/TBC suffixes and known Segment, LaunchDarkly, Datadog, Sentry, updater, and staging hosts;
- Chromium host-resolver rules fail Dia/TBC/internal names before browser navigation;
- provider and artifact URL validation rejects Dia/TBC/internal destinations;
- product-knowledge tools are not exposed to providers.

The runtime network log strips paths for external browsing origins. The custom Sparkle feed is an empty loopback appcast and automatic update preferences are disabled. Official Dia retains normal updates.

There is no Dia-owned network exception. Official Sync is research-only because modifying the bundle invalidates Dia's official Apple signature; the project neither impersonates that identity nor submits requests meant to conceal the clone. Local migration instead uses Dia's native browser importer against a sanitized staging profile and requires no service access.

## Sandboxes

The project deliberately keeps separate trust boundaries:

- Chromium runs without `--no-sandbox` by default.
- Dia's agent handler keeps its native Seatbelt profile; only the gateway port is corrected to **8765** so the model request can reach the local bridge.
- Codex receives a sanitized environment, a read-only empty working directory, no network access for its built-in actions, and an abort if it attempts a command, file change, MCP call, or built-in web search.

The public web client and selected remote providers run in the bridge because those are the explicit network capabilities the user requested. Reports remain in Dia's agent sandbox.

## Isolation and upgrades

The clone has a separate bundle ID, profile, user-data directory, Keychain label, updater state, and URL/document registration. No account token, cookie, saved password, Keychain item, chat, Memory, or open session is copied from official Dia. The optional local importer stages only explicitly supported browser data with owner-only permissions.

Most patches locate unique strings, signatures, Swift metadata, or runtime view structures. The native Report controller gate and its setup target, Report validator, and hidden Prompt Tools entry points are found semantically rather than by fixed file offsets. Prompt Tools offsets are retained for compatibility research, but the current production controller is not constructed because its initializer requires Dia's unavailable task-local dependency context. The anonymous account/capability patch still has a small audited table for builds 85660, 85823, and 86064.

`bridge/config/dia-mods.json` is the single manifest for every independent Dia Mod. A profile-local `mods.json` records optional choices and migrates older `modules.json` state. The launcher passes the resolved set to the native bootstrap and bridge; the installer conditionally applies build-time patches and seals both the complete and build-only snapshots into `Info.plist`. Runtime mods can be bisected with a restart. A change that would remove an already-applied binary patch is rejected and requires a clean rebuild from official Dia. The optional `mod-manager` adds a guarded Mods tab to Dia's Settings split view and renders the authenticated loopback manager inside that pane; native preference panes remain untouched.

`src/config/supported-dia-builds.json` is the update allowlist. **./dia-custom update** validates the official bundle and every enabled Dia Mod against it before creating a temporary clone. Only then does it apply and verify patches, sign the result, preserve the prior clone as a backup, and swap. Unknown or partially audited layouts leave the existing clone untouched. Native Sparkle checks remain disabled and point to an empty loopback feed, so an update cannot bypass this audit path.

Bridge configuration, credentials, model choice, memory, connector data, sessions, and coverage live outside the app bundle and survive supported rebuilds.
