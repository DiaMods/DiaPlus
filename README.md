# Dia+

Dia+ keeps Dia's native browser, New Chat, tools, Memory settings and Reports while routing AI through providers you control. It runs as **Dia+.app**, with bundle ID **local.rttm.dia**, its own profile and Keychain label. The existing bundle ID and `Dia Custom RTTM` profile directory are retained for upgrade compatibility. Official Dia and its account remain separate.

The installed release is **Dia 1.51.0, build 87864, on Apple silicon**. **19 Mods** pass, including local AI routing, anonymous profile and native Reports. The guarded routing update preserves native encrypted requests and other backend services; a clean-profile native Codex chat returned the requested answer. Installation retained the previous app and closed-profile backups, and its two-launch profile preflight preserved extensions, sessions and pinned-tab data. Developer surfaces remain unavailable because Dia changed its private Prompt Tools presenter; that optional Mod is omitted for this build. The full suite passed with **229 bridge tests passing**, one explicit Apple native-image runtime skip and no failures. See [Status](docs/STATUS.md) for completed live checks and remaining verification.

## Start here

For another Mac, use the **Dia+ modifier ZIP**: extract it and open **Install Dia+.command**. It includes Node and precompiled helpers and obtains official Dia on that Mac when needed. Codex uses the recipient's local installation. See [installer instructions](docs/RELEASE-INSTALL.md).

Private releases are hosted in **DiaMods/DiaPlus**. Repository read access gates only the updater; manually shared installer ZIPs need no GitHub login. See [private release setup and owner workflow](docs/PRIVATE-RELEASES.md).

To test release packaging locally (requires Node, Xcode 27 and the audited official Dia source; uses a temporary signing key):

```sh
node scripts/test-private-release.js /path/to/audited/official/Dia.app
```

The [manual release workflow](.github/workflows/release.yml) validates the latest configured official feed and audited native mods, creates a signed versioned mod bundle, reuses the independently versioned installer engine, and assembles a fresh full installer ZIP. Signing secrets stay outside build/test jobs. After isolated compiler-free installer QA, it creates new tags and **draft releases only**. Publish a private prerelease for opt-in Beta testing, then promote the same tested assets to Stable. GitHub App/repository/signing setup and publication require explicit owner actions; the workflow has not yet run in the private repository. Test-key local assets must not be published.

For development, a first install or rebuild from the official application:

```sh
./dia-custom setup /Applications/Dia.app
```

Setup installs the custom app in Applications, configures its isolated profile, prepares safe native import data and opens it. Afterward, launch it normally from Applications: the app owns its bundled Node runtime, local AI bridge and launch policy. It registers its own `http`/`https` handlers and can be chosen as the default browser.

Choose a model in the native chat toolbar or **View → Developer → AI Model**. Codex models, labels, reasoning levels and the recommended default are discovered from your installed Codex through `model/list`, using its existing login. New models appear automatically on catalog refresh; the list is not hardcoded. Settings also support Apple Foundation Models, Ollama at `127.0.0.1:11434`, OpenAI Responses, and custom OpenAI-compatible Responses or Chat Completions endpoints.

```text
./dia-custom settings           Open Dia Mod Settings
./dia-custom models             Print the discovered model catalog
./dia-custom openai-key         Save or clear the OpenAI key privately
./dia-custom mods               List or configure Dia Mods
./dia-custom compatibility      Validate every Mod against a Dia app
./dia-custom update             Rebuild from the installed official Dia app
./dia-custom migrate            Open native import from official Dia
./dia-custom doctor             Verify the installed app and bridge
./dia-custom test               Run provider, tool, patch and build checks
./dia-custom status             Print verified coverage and remaining checks
```

Dia Mod Settings groups controls into **Models, Mods, Connections, Knowledge, Memory, Updates and Advanced** tabs. Profile dropdowns use the browser’s actual profile names and retain the selected profile across sections and reloads. Existing settings deep links continue to open the matching tab.

## Native chat, tools and media

Dia still assembles browser context and executes its native harness. Schemas are discovered dynamically, including deferred tools loaded through native `ToolSearch`. Tab mentions, tab reading/opening, file and skill tools, calculation and Report upload retain Dia's tool stream and progress cards. Public web search/fetch, imported people lookup and Memory have local implementations. Cookies used by browser-session tools remain inside Chromium.

Markdown tables and equations use Dia's existing table and SwiftMath views. Native Report creation and revision retain `artifact-generation`, `report-kit`, the per-context file sandbox, bounded upload validation and Reports-library ingestion. Reports open through Dia's sandboxed `chrome-untrusted://…dia-artifacts/` presentation.

All provider adapters now support incremental final text, including safe text deltas from Codex and Apple's structured decisions. Tool decisions are validated before execution; malformed responses, interrupted streams and explicit tool failures are surfaced.

| Input | Routing |
| --- | --- |
| Images | Native image channels for capable OpenAI-compatible models; staged SDK image inputs for Codex; local Vision observations by default for Apple |
| PDFs | Native PDF channels for Responses/Chat Completions; local text extraction and bounded page images for other adapters |
| Audio files | WAV/MP3 native audio channel for capable Chat Completions models; local on-device transcription for other routes |
| Video files | Bounded local frame sampling, with available speech transcription; this is not a continuous native video model channel |
| Native dictation | Dia's raw M4A request is served locally with its named transcription event stream |

Media staging is private, bounded and removed after use. A provider must support the native input channel selected for it. Apple's native image attachment API is available as an explicit configuration option, but the installed macOS 27 beta model can reject it with a guardrail error; local Vision preprocessing is the default. Speech assets can be prepared in settings. A native URLSession M4A request passed through the complete local transcription bridge; microphone recording through Dia's UI has not yet been verified end to end. Apple Private Cloud Compute requires Apple's managed entitlement and is unavailable in an ordinary personal build.

## Memory, Apps and connectors

Local Memory stores isolated-profile history, native page results, chat turns and imported records in an owner-only SQLite index. The selected provider can derive durable Memories with provenance and recall them in later chats. Profiles remain separate; incognito activity, excluded hosts and sensitive data are filtered. Native **Settings → Memory** controls the local index. Off stops capture and recall without deleting entries; Reset removes browsing/chat/derived Memory while retaining connector records. Remote providers receive the filtered evidence needed for a requested model operation; the index itself stays on this Mac.

**Live connectors** settings can add, edit, connect, inspect and disconnect:

- MCP servers using Streamable HTTP, legacy HTTP+SSE or stdio;
- OAuth with discovery, PKCE, refresh/revocation and supported public-client registration, or manually supplied client details;
- generic CLI tools with fixed executable/argument templates;
- the Spark Mail CLI preset.

Saving configuration does not connect it. Connections, credentials, sessions, schemas and indexed records are scoped to the selected Dia profile. Connected MCP and CLI integrations reopen on browser restart; an explicit Disconnect remains disconnected. Temporary errors retain the saved preference and retry, while missing authorization is shown as needing sign-in. Incremental indexing accepts a connector's explicitly read-only changes tool and advances its cursor after successful indexing. Service-specific sync integrations are not assumed.

Spark 1.3.1 exposes 26 tools spanning mail/calendar/contact reads, attachments, drafts, triage, assignment, sending/scheduling, comments and event changes. Older versions retain the 11-tool read catalog. Spark's own **Settings → AI Agents** permissions apply, and all Dia profiles share the same signed-in Spark Desktop accounts. Sending and other external communication require explicit user authorization. Real write operations were not used in tests. See [Connectors](docs/CONNECTORS.md) and [manifest examples](examples/connectors/).

Native Apps, live connectors and Morning Brief are separate Mods. Morning Brief uses Dia's bundled `clia-brief` agent and Report template with the selected model, one designated profile and one automatic attempt per local day between 5 AM and 11 AM while the browser is open. It retains partial-source diagnostics and records success only after native artifact ingestion. Unfinished or failed runs do not trigger automatic retries, and launching later in the day waits until the next morning. The guarded native WindowController action executes on build 86584; a complete scheduled brief with connected sources remains a separate live QA check.

## Knowledge and research

The **local-knowledge** Mod adds a profile-specific library of text, Markdown, public pages and saved research, with source provenance and search/read tools in chat. The **local-workflows** Mod runs manual research and interval schedules using the selected provider and read-only local/connector tools, then saves results to that library.

Schedules start disabled and run only after being explicitly enabled, while the bridge is running. They skip missed intervals after restart and do not overlap. Native browser actions and remote write tools are excluded from this runner. See [Local workflows](docs/LOCAL-WORKFLOWS.md) for limits and APIs.

## Custom updates and Mods

The **custom-updater** Mod is **on by default** and is separate from the required **update-blocker** Mod. The blocker prevents stock Sparkle replacement. The custom updater redirects native update controls to local settings, checks the official release feed, verifies the signed archive and publisher, validates every configured Mod, and builds a staged custom app. Background checks only announce availability; preparation and installation are explicit actions.

New release clients obtain signed mod bundles from private `DiaMods/DiaPlus` releases using their own GitHub authorization entered only in Updates settings. Tokens are stored in macOS Keychain. Repository read access is required for checks/preparation/installation, not for browser or AI use. Stable ignores prereleases; Beta is opt-in. Compatible precompiled helpers and a pinned bundled runtime remove compiler/Node/npm requirements. Required compatibility failures stop preparation; optional failures require confirmation before temporary omission, retaining stored choices for later compatible updates. Older clients require the new manual installer once. See [setup and rollout](docs/PRIVATE-RELEASES.md).

Installation snapshots the complete closed profile, preflights the candidate against a disposable copy, and retains the previous app with its matching profile snapshot. Launch and preflight use the custom app's existing macOS Keychain encryption, preserving protected preferences and extension registrations. Replacement and launch-health failures have a rollback path. The CLI supports the same optional compatibility exclusions with an explicit choice or `--allow-disable-incompatible`; critical identity, network, updater and routing checks always fail closed. Known build numbers never bypass validation of the candidate's actual contents.

Configure optional Mods in native **Settings → Mods** or the CLI:

```sh
./dia-custom mods disable developer-tools
./dia-custom mods enable developer-tools
```

Runtime Mods apply on restart. Disabling a binary patch requires a clean rebuild. The installed Mod snapshot is checked by `doctor`. When a Developer ID identity is available, builds use it for stable macOS permission identity; `DIA_CUSTOM_SIGN_IDENTITY=-` selects the ad-hoc fallback.

## Isolation and import

Normal websites and selected providers remain reachable. Dia-owned AI, registry, telemetry, crash and stock-update destinations are blocked or redirected locally. The custom updater's verified download path is separate. Chromium's sandbox, Dia's per-agent file sandbox and the restricted Codex decision workspace remain enabled. Codex's own built-in action tools and inherited MCP connections are disabled in that decision process; browser actions run through Dia's harness.

The **dia-import** Mod reuses Dia's native importer with sanitized local staging. Profiles, bookmarks, history, favicons, extension packages and local pinned-tab/group data can be imported. Account tokens, cookies, passwords, Keychain items, open sessions, chats, Memory, Reports and extension site data are excluded. Official account authentication and browser Sync are outside this project's scope.

## Project and runtime files

| Location | Purpose |
| --- | --- |
| `bridge/src/providers/` | Provider adapters and validated text streaming |
| `bridge/src/connectors/` | MCP, OAuth, CLI and Spark adapters |
| `bridge/src/local-tools/` | Memory, connectors and public web tools |
| `bridge/src/knowledge.js`, `workflows.js` | Local library and research schedules |
| `bridge/src/custom-updater.js`, `update-worker.js` | Update preparation and installation |
| `src/bootstrap/`, `src/patches/` | Guarded native integration and binary patches |
| `bridge/config/dia-mods.json` | Mod defaults, dependencies and rebuild policy |
| `src/config/supported-dia-builds.json` | Audited build metadata; structural checks still run |
| `scripts/`, `research/` | Build/test workflows and native analysis tools |

The app lives at `/Applications/Dia+.app`; the profile is `~/Library/Application Support/Dia Custom RTTM`. Its `Bridge/.state` contains provider configuration, separate credentials, model/tool catalogs, Memory, knowledge, connector manifests and workflow state. `Diagnostics` holds runtime logs. Bridge code and required runtime executables are bundled inside the app.

See [Architecture](docs/ARCHITECTURE.md), [Dia Mods](docs/MODS.md), [Status](docs/STATUS.md) and the [September audit](docs/AUDIT-2026-09-07.md).
