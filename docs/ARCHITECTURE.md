# Architecture

## Runtime flow

1. Dia's native New Chat UI assembles its normal conversation, browser context, and currently available tool schemas.
2. The guarded agent-handler patch directs that Anthropic-compatible request to **127.0.0.1:8765**.
3. **ProviderManager** reads the persistent selection and augments the request with local-only tools.
4. The selected adapter runs Codex, Apple Foundation Models, OpenAI Responses, or an OpenAI-compatible Chat Completions backend.
5. Local memory calls execute inside the bridge. Native tool calls are streamed back to Dia with the original tool name, ID, and input schema.
6. Dia executes browser/report tools and sends tool results through another turn. Final text and provider activity summaries render in Dia's existing UI.

The model never needs to automate Chromium directly. Dia retains tab context, tool execution, attachments, permission surfaces, and Reports-library ownership.

## Provider boundary

Provider definitions and selection live in **Bridge/.state/config.json**. A sanitized discovery catalog is written to **Bridge/.state/models.json** for the injected native picker. Both are owner-only files.

Adapters share one result contract:

- final text plus usage;
- provider-authored reasoning summaries suitable for Dia's activity UI;
- zero or more typed tool calls.

Codex uses the installed SDK and live web access. Apple runs in a separate Swift helper so Foundation Models support does not depend on Dia's private ABI. OpenAI uses the Responses API. Ollama and custom servers use the OpenAI-compatible Chat Completions API. The network-policy module rejects provider URLs owned by Dia or The Browser Company.

The localhost settings API requires an unguessable token for mutations and deliberately sends no cross-origin headers. The native picker reads that token from the mode-0600 catalog. OpenAI credentials are placed in the per-login launchd environment and are never written into provider configuration.

## Native model UI

The runtime bootstrap first tries Dia's own hidden model-selector object. Build 85823 creates no object in the observed New Chat state, so Dia Custom also installs:

- an AppKit pop-up in BoostCommandBar.ToolbarView's standard content stack when that stable stack exists;
- a View → Developer → AI Model submenu that works when toolbar internals change;
- a Model Providers & Settings item that opens the localhost provider page.

Catalog and HTTP boundaries are version-neutral. Only locating the optional inline toolbar stack is best-effort.

## Tool boundary

Tools supplied by Dia are normalized but not reimplemented. A provider can call them, and the bridge sends native tool_use blocks back to the handler. This preserves the full set Dia exposes for the user's current capabilities.

Local memory is the intentional exception. The bridge injects memory_search and memory_query definitions, executes those calls against local SQLite, appends tool results to the in-flight conversation, and asks the same provider to continue. Local and native actions are kept in separate tool rounds.

The memory store imports:

- Chromium history from the isolated Dia Custom profile;
- URL, title, and page text present in native tool results;
- future user and assistant messages.

It refreshes browser history every five minutes. It does not decrypt or repurpose Dia's account-backed databases.

## Reports

Dia's handler supplies the original artifact-generation/report prompts and sandboxed file tools. Models are told to use those supplied tools rather than the bridge filesystem. Upload remains the native upload_artifact tool, which is the path that registers a result in Dia's Reports library.

Official responses include a proprietary tool-safety stream event before upload_artifact. Dia Custom now emits the matching local event with the exact tool-use ID and still notifies Dia's native CHECK controller, while the handler resolves its permission locally. This is implemented and protocol-tested headlessly; final native Reports-library ingestion requires one unlocked build-85823 run.

## Network boundary

Website traffic is not sandboxed. Endpoint strings for Dia AI, model registry, tool cache, telemetry, and crash upload are redirected to localhost. The injected NSURLSession task hook independently cancels root and subdomain requests for Dia and The Browser Company, plus known Segment, LaunchDarkly, updater, staging-model, and Dia telemetry hosts. Logs mark each resumed task as ALLOW or BLOCKED.

The custom Sparkle feed points at an empty localhost appcast and all automatic update preferences are disabled. The original Dia app retains normal updates.

No account token is copied into the clone. Codex/OpenAI inference reaches OpenAI, Apple Private Cloud reaches Apple, Ollama remains local, and normal browsing reaches sites selected by the user.

## Isolation and upgrades

The clone has:

- bundle ID **local.rttm.dia**;
- a separate application profile and Chromium user-data directory;
- a separate Keychain service label;
- no URL/document-handler registration;
- no automatic updater.

Most integration points are string/signature scanned or runtime-discovered. The anonymous-account and capability patch still has a small audited ARM64 layout table for builds 85660 and 85823. **./dia-custom update** clones the official app into a temporary bundle, applies every guard, signs it, and swaps it only after success. Unknown bytes or builds stop the process and leave the existing clone intact.

Provider configuration, model selection, bridge sessions, and memory are outside the app bundle, so supported rebuilds preserve them.

## Future account connectors

Model identity and service identity are deliberately separate. A later connector layer can add user-authorized OAuth accounts and index service content into the same local memory store without giving Dia's AI service control of inference. Native account-backed tools remain capability-gated today; this project does not synthesize a Dia account or extract credentials from the real app.
