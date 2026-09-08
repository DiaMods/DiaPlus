# Custom connectors

Add, edit and connect manifests in the local settings page. Changes take effect without restarting the bridge. Connections, OAuth credentials, local process environment secrets and imported records are scoped to the selected Dia profile. Saving configuration does not connect it.

Examples in [examples/connectors](../examples/connectors/) cover Streamable HTTP, legacy HTTP+SSE, stdio MCP, OAuth discovery, a custom CLI, and Spark. Replace example executable paths and service domains with the actual values for your connector.

## Connection persistence

Connect saves the selected profile's connection intent. On bridge startup, saved connections reopen their transports, rediscover tools and check local executables in the background. Spark also checks its Desktop session and installed CLI version. Temporary failures keep the saved intent and retry every 30 seconds; missing or rejected credentials show **Authorization required** until you reconnect. Existing OAuth refresh tokens are reused without opening another authorization window.

Disconnect saves an explicit off state before removing credentials. It stays off through browser and bridge restarts. Credentials left over from an interrupted cleanup never enable a disconnected profile. Editing or removing a manifest clears its connections and credentials across profiles. Late authorization, discovery and startup results cannot reverse a newer disconnect or edit. Reconnection performs initialization and discovery only; failed tool calls are never replayed.

Settings list real local Dia profiles with their browser display names and stable directory IDs. The profile list is available to authenticated local settings clients at `GET /api/profiles`; it exposes no filesystem paths or account metadata. Connector status adds `desiredConnected` for saved intent and `connectionState` (`connecting`, `connected`, `disconnected`, `auth-required` or `error`) for runtime status. Older connected records migrate to saved intent; older disconnected records remain off.

## MCP

`streamable-http` uses the current MCP HTTP transport. `http-sse` supports the older persistent GET event stream with a separate POST endpoint. The SSE POST endpoint must share the server's origin. `stdio` starts the configured absolute executable directly, with `args` as literal arguments. It performs initialization, reads newline-delimited JSON-RPC, matches concurrent replies and terminates the process on disconnect or malformed/oversized output. No tool call is automatically replayed after failure. Messages are bounded to 4 MiB and requests to 30 seconds by default.

For local processes, `cwd` is optional, `timeoutMs` accepts 100–120000, and `envKeys` explicitly lists additional inherited environment variables. Environment secret values supplied when connecting are stored in the credential store, not the manifest. Runtime injection variables such as `NODE_OPTIONS`, `LD_*` and `DYLD_*` are rejected. Only a small desktop environment is inherited by default.

HTTP destinations require `allowedDomains`, including any separate OAuth server hosts. Remote URLs must use HTTPS. Redirects are rejected. OAuth with `oauth: {}` discovers protected-resource metadata, then OAuth or OIDC server metadata. The authorization server must advertise PKCE S256 and public-client support. Public dynamic registration runs if no client ID is provided; registrations are retained for reconnects. If dynamic registration is unavailable, supply `oauth.clientID`. Manual `authorizationURL`, `tokenURL`, optional `revocationURL` and `scopes` remain supported. Authorization and token requests include the MCP resource identifier. A hosted client-ID metadata document is not bundled; servers requiring one need a registered client ID.

These transports follow the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [legacy HTTP+SSE protocol](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports), and [MCP OAuth discovery requirements](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). Root listing, server-requested sampling and elicitation are not advertised.

## CLI adapters and Spark

The generic `cli` transport defines each tool's schema and a fixed `args` template. Each argument is either a literal string or an object such as `{"input":"query","flag":"--query"}`. Array inputs repeat that flag; boolean flags are omitted when false. Tool input cannot choose the executable, create argument names, or add undeclared inputs. Set `output: "json"` for structured JSON output, otherwise stdout becomes text. The process has a timeout and 4 MiB output limit, and stderr is not retained in status logs.

Spark 1.3.1 was verified using the installed CLI's help and embedded documentation. It exposes 26 tools: the original mail/calendar/contact/team/meeting reads plus attachment downloads, templates/signatures, drafts, message triage and assignment, sending/scheduling, comments, contact actions and event create/update/delete/RSVP. Attachment reads automatically download the file and return its local path. Commands use fixed validated arguments without a shell. The installed CLI version is checked during connection; older versions retain the original 11-tool read catalog.

Spark's **Settings → AI Agents** controls each underlying account/shared inbox's access level. `read-only`, `triage` and `send` allow progressively broader operations. Dia profiles use separate connector enablement but share the signed-in Spark Desktop accounts. Draft/send are separate tools so content can be reviewed before mail is sent. Sending, comments, invitations and cancellations require explicit user authorization. Only fixtures were used to test write operations; no real messages or calendar changes were made.

## Incremental indexing

A manifest can specify `"sync": {"tool":"changes","cursorArgument":"cursor","arguments":{}}`. The named discovered tool must advertise `readOnlyHint: true`. It returns structured JSON (or JSON text) containing `records`, `cursor` and optional `deletedIDs`. Records require stable string `id` values and can provide `title`, `content`, `url`, `updatedAt`, `metadata`, or `kind: "person"`. Each batch allows up to 5000 records/deletions. Repeated IDs update existing records, and deletion IDs remove only that connector's records in the selected profile.

Use the connector's Sync action (`POST /api/apps/connectors/<id>/sync`, local administration token required) to fetch a batch. Its cursor advances only after indexing succeeds. Concurrent sync calls for a connection are combined. Repeated sync calls pass the saved cursor. Unsupported services are not polled automatically, and no service-specific account sync is fabricated.

Local imported-record search, full-content reads and person lookups enforce the chat's profile. Imports that were globally shared by older Dia Custom versions migrate into `Default`. Existing browsing/chat memory keeps its original profile. Official Dia account and browser Sync are outside this feature.
