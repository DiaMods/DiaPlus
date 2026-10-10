export function renderSettingsPage(adminToken) {
  const token = JSON.stringify(adminToken).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dia Mod Settings</title>
  <style>
    :root { color-scheme: light dark; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --accent: #5b5bd6; --line: color-mix(in srgb, CanvasText 13%, transparent); --muted: color-mix(in srgb, CanvasText 62%, Canvas); --surface: color-mix(in srgb, Canvas 97%, CanvasText 3%); }
    * { box-sizing: border-box; }
    body { max-width: 1080px; margin: 0 auto; padding: 44px 32px 80px; background: Canvas; color: CanvasText; line-height: 1.45; }
    .page-header { display: flex; gap: 16px; align-items: center; margin-bottom: 28px; }
    .brand-mark { display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 auto; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); }
    .brand-mark svg { width: 26px; height: 26px; }
    h1 { font-size: 28px; letter-spacing: -.8px; margin: 0 0 3px; line-height: 1.2; }
    h2 { font-size: 21px; letter-spacing: -.4px; margin: 30px 0 7px; scroll-margin-top: 100px; }
    .settings-panel > h2:first-child { margin-top: 28px; }
    h3 { font-size: 15px; margin: 0 0 7px; }
    p { margin: 0; }
    .muted { color: var(--muted); line-height: 1.55; }
    .section-intro { max-width: 740px; margin-bottom: 18px; }
    .settings-tabs { display: flex; gap: 5px; padding: 8px 0; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 2; background: Canvas; overflow-x: auto; scrollbar-width: thin; }
    .settings-tabs button { background: transparent; color: var(--muted); padding: 10px 16px; white-space: nowrap; flex: 0 0 auto; font-weight: 550; }
    .settings-tabs button[aria-selected="true"] { background: color-mix(in srgb, var(--accent) 12%, Canvas); color: color-mix(in srgb, var(--accent) 80%, CanvasText); }
    .settings-panel { min-width: 0; }
    .card { border: 1px solid var(--line); border-radius: 14px; padding: 22px; margin-top: 16px; background: var(--surface); }
    .card > .muted:first-child:empty { display: none; }
    .row { display: flex; gap: 10px; align-items: center; }
    .profile-row { padding-bottom: 16px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
    .profile-row select { max-width: 300px; }
    .profile-row label { font-weight: 550; white-space: nowrap; }
    select, button, textarea, input { font: inherit; }
    select, input, textarea { color: CanvasText; background: Canvas; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 8px; }
    select { flex: 1; min-width: 0; padding: 10px 32px 10px 11px; }
    input { min-width: 0; padding: 10px; }
    input[type="checkbox"] { accent-color: var(--accent); }
    button { padding: 10px 14px; border: 1px solid transparent; border-radius: 8px; background: var(--accent); color: white; cursor: pointer; font-weight: 500; }
    button:hover:not(:disabled) { filter: brightness(.94); }
    button.secondary { background: Canvas; border-color: var(--line); color: CanvasText; }
    button:disabled, select:disabled { opacity: .55; cursor: default; }
    :focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 65%, transparent); outline-offset: 3px; }
    .memory-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat { padding: 15px; border-radius: 9px; background: Canvas; border: 1px solid var(--line); }
    .stat strong { display: block; font-size: 24px; margin-bottom: 4px; letter-spacing: -.5px; }
    .stat span { font-size: 12px; color: var(--muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .provider { padding: 18px 0; border-bottom: 1px solid var(--line); }
    .provider:first-child { padding-top: 0; }
    .provider:last-child { border-bottom: 0; padding-bottom: 0; }
    .mod { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; padding: 18px 0; border-bottom: 1px solid var(--line); }
    .mod:last-child { border-bottom: 0; }
    .mod-title { font-weight: 600; margin-bottom: 5px; }
    .mod-meta { font-size: 12px; margin-top: 5px; }
    .mod input[type="checkbox"] { width: 36px; height: 22px; }
    .provider-title { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 9px; }
    .provider .row { margin-top: 10px; }
    .provider input { flex: 1; }
    .add-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .add-grid .wide { grid-column: 1 / -1; }
    .add-grid label { display: grid; gap: 6px; font-weight: 500; }
    .add-grid label .muted { font-weight: 400; font-size: 12px; }
    .add-grid label input, .add-grid label select { width: 100%; }
    fieldset { border: 0; margin: 14px 0 0; padding: 0; min-width: 0; }
    [hidden] { display: none !important; }
    .connector-meta { overflow-wrap: anywhere; margin: 8px 0; }
    .connector-tools { margin: 10px 0; padding-left: 22px; overflow-wrap: anywhere; }
    .connection-badge { font-size: 12px; padding: 3px 9px; border-radius: 20px; background: color-mix(in srgb, CanvasText 7%, Canvas); }
    .connection-badge[data-state="connected"] { color: light-dark(#18603a, #78d8a3); background: light-dark(#e4f3eb, #183a29); }
    .connection-badge[data-state="error"], .connection-badge[data-state="auth-required"] { color: light-dark(#885115, #edc48a); background: light-dark(#fff1da, #45331e); }
    button.danger { background: Canvas; border-color: color-mix(in srgb, #b4232c 30%, Canvas); color: light-dark(#b4232c, #ff9299); }
    progress { width: 100%; height: 8px; accent-color: var(--accent); }
    .update-progress { margin: 12px 0; }
    .update-progress .muted { margin-top: 5px; font-size: 12px; }
    .update-review { padding: 13px; margin: 12px 0; border: 1px solid color-mix(in srgb, #b7791f 35%, Canvas); border-radius: 9px; background: color-mix(in srgb, #b7791f 8%, Canvas); white-space: pre-line; }
    textarea { width: 100%; min-height: 380px; padding: 13px; tab-size: 2; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; line-height: 1.6; resize: vertical; }
    #status { min-height: 22px; margin-top: 12px; }
    .error { color: light-dark(#b4232c, #ff9299); }
    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .9em; overflow-wrap: anywhere; }
    details { margin-top: 16px; }
    summary { cursor: pointer; font-weight: 550; padding: 4px 0; }
    details[open] > summary { margin-bottom: 12px; }
    a { color: color-mix(in srgb, var(--accent) 80%, CanvasText); }
    @media (max-width: 720px) { body { padding: 26px 18px 60px; } .settings-tabs button { padding: 9px 12px; } .memory-grid { grid-template-columns: repeat(2, 1fr); } .row { flex-wrap: wrap; } .provider input { flex-basis: 100%; } .card { padding: 18px; } }
    @media (max-width: 480px) { .add-grid { grid-template-columns: 1fr; } h1 { font-size: 24px; } .page-header { gap: 12px; } .profile-row select { max-width: none; } .profile-row label { width: 100%; } }
  </style>
</head>
<body>
  <header class="page-header">
    <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M9.7 4.3 10.3 2h3.4l.6 2.3 1.6.9 2.3-.6 1.7 2.9-1.7 1.7v1.8l1.7 1.7-1.7 2.9-2.3-.6-1.6.9-.6 2.3h-3.4l-.6-2.3-1.6-.9-2.3.6-1.7-2.9L5.8 11V9.2L4.1 7.5l1.7-2.9 2.3.6z" transform="translate(0 1.9)"/><circle cx="12" cy="12" r="3"/></svg></div>
    <div><h1>Dia Mod Settings</h1><p class="muted">Make Dia your own. Manage models, connections, and local data.</p></div>
  </header>
  <nav class="settings-tabs" role="tablist" aria-label="Settings sections">
    <button type="button" role="tab" id="tab-models" data-settings-tab="models" aria-controls="panel-models" aria-selected="true" tabindex="0">Models</button>
    <button type="button" role="tab" id="tab-mods" data-settings-tab="mods" aria-controls="panel-mods" aria-selected="false" tabindex="-1">Mods</button>
    <button type="button" role="tab" id="tab-connections" data-settings-tab="connections" aria-controls="panel-connections" aria-selected="false" tabindex="-1">Connections</button>
    <button type="button" role="tab" id="tab-knowledge" data-settings-tab="knowledge" aria-controls="panel-knowledge" aria-selected="false" tabindex="-1">Knowledge</button>
    <button type="button" role="tab" id="tab-memory" data-settings-tab="memory" aria-controls="panel-memory" aria-selected="false" tabindex="-1">Memory</button>
    <button type="button" role="tab" id="tab-updates" data-settings-tab="updates" aria-controls="panel-updates" aria-selected="false" tabindex="-1">Updates</button>
    <button type="button" role="tab" id="tab-advanced" data-settings-tab="advanced" aria-controls="panel-advanced" aria-selected="false" tabindex="-1">Advanced</button>
  </nav>
  <div id="profileStatus" role="status" class="muted"></div>
  <main>
  <section class="settings-panel" id="panel-models" role="tabpanel" aria-labelledby="tab-models" tabindex="0">
<h2 id="model-selection">Your chat model</h2>
  <p class="muted section-intro">Choose the model Dia uses for chat, research, and writing.</p>
  <div class="card">
    <div class="row">
      <select id="models" aria-label="Selected model"></select>
      <button id="select">Use model</button>
      <button id="refresh" class="secondary">Refresh</button>
    </div>
    <div id="status" class="muted"></div>
  </div>

  <h2 id="provider-configuration">Provider configuration</h2>
  <div class="muted">Manage provider credentials and model options. Saved keys are stored privately on this Mac and are never shown here.</div>
  <div class="card" id="providerList"></div>
  <div class="card">
    <strong>Local speech transcription</strong>
    <div id="speechStatus" class="muted" role="status" style="margin:10px 0">Checking local speech assets…</div>
    <button id="prepareSpeech" class="secondary">Prepare local speech</button>
    <div class="muted" style="margin-top:10px">Downloads Apple's speech files for this Mac's language when needed. Recorded audio and video speech can then be transcribed locally.</div>
  </div>

  <h2 id="add-provider">Add OpenAI-compatible provider</h2>
  <div class="card">
    <div class="add-grid">
      <label>Provider ID<input id="newProviderID" placeholder="lm-studio"></label>
      <label>Display name<input id="newProviderLabel" placeholder="LM Studio"></label>
      <label class="wide">Base URL<input id="newProviderURL" type="url" placeholder="http://127.0.0.1:1234/v1"></label>
      <label class="wide">Models discovery URL (optional)<input id="newProviderDiscovery" type="url" placeholder="https://example.com/v1/models"></label>
      <label>API format<select id="newProviderAPI"><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select></label>
      <label>Model IDs<input id="newProviderModels" placeholder="model-one, model-two"><span class="muted">Separate multiple IDs with commas.</span></label>
    </div>
    <div class="row" style="margin-top:10px"><button id="addProvider">Add provider</button><span id="providerStatus" class="muted"></span></div>
  </div>

  </section>
  <section class="settings-panel" id="panel-mods" role="tabpanel" aria-labelledby="tab-mods" tabindex="0" hidden>
  <h2 id="dia-mods">Dia Mods</h2>
  <div class="muted">Turn browser features on or off. Changes that need a restart or rebuild are marked below.</div>
  <div class="card">
    <div id="modNotice" class="muted"></div>
    <div id="modList"></div>
    <div id="modStatus" class="muted" style="margin-top:10px"></div>
  </div>

  </section>
  <section class="settings-panel" id="panel-connections" role="tabpanel" aria-labelledby="tab-connections" tabindex="0" hidden>
  <h2 id="live-connectors">Live connectors</h2>
  <div class="muted">Add an MCP server or another live connector to give your AI access to its tools. Connections are saved separately for each Dia profile and restored when you reopen the browser.</div>
  <div class="card">
    <div class="row profile-row">
      <label for="liveProfile">Dia profile</label>
      <select id="liveProfile" data-profile-select aria-describedby="liveProfileHelp" disabled><option value="Default">Loading profiles…</option></select>
      <button id="refreshLive" class="secondary">Refresh connections</button>
    </div>
    <div id="liveProfileHelp" class="muted">Connections and credentials are separate for each profile.</div>
    <div id="liveNotice" class="muted" role="status" style="margin-top:10px"></div>
    <div id="liveList"></div>
    <details style="margin-top:12px"><summary>Browser session connectors</summary><div id="nativeConnectorList"></div></details>
    <div id="liveStatus" class="muted" role="status" style="margin-top:10px"></div>
    <div id="liveAuthLink"></div>
  </div>
  <form class="card" id="liveConnectorForm">
    <div class="mod-title" id="liveFormTitle">Add a live connector</div>
    <fieldset id="liveFields">
      <div class="add-grid">
        <label class="wide">Connector type<select id="liveType"><option value="mcp">MCP server (Streamable HTTP)</option><option value="http-sse">MCP server (legacy SSE)</option><option value="stdio">MCP server (local process)</option><option value="cli">CLI adapter (advanced JSON)</option><option value="spark-cli">Spark Mail (local CLI)</option></select></label>
        <label>Connector ID<input id="liveID" required maxlength="120" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*" placeholder="my-mcp"></label>
        <label>Display name<input id="liveName" required maxlength="120" placeholder="My connector"></label>
      </div>
      <fieldset id="mcpFields" class="add-grid">
        <label class="wide">MCP endpoint<input id="liveEndpoint" type="url" required placeholder="http://127.0.0.1:3000/mcp"></label>
        <label class="wide">Allowed hosts<input id="liveHosts" required placeholder="127.0.0.1, auth.example.com"><span class="muted">Comma-separated host names, including all OAuth hosts when used.</span></label>
        <label class="wide">Authentication<select id="liveAuthentication"><option value="none">None</option><option value="bearer">Bearer token</option><option value="oauth">OAuth with PKCE</option></select></label>
      </fieldset>
      <fieldset id="processFields" class="add-grid" hidden disabled>
        <label class="wide">Executable path<input id="processCommand" placeholder="/opt/homebrew/bin/npx" pattern="/.*" required></label>
        <label class="wide">Arguments (JSON array)<input id="processArgs" value="[]" placeholder='["-y", "@example/mcp-server"]'></label>
        <label class="wide">Working directory (optional)<input id="processCwd" placeholder="/Users/you/project"></label>
        <label class="wide">Secret environment variable names<input id="processEnv" placeholder="API_KEY"><span class="muted">Enter values on the saved connector card. Values stay out of configuration.</span></label>
      </fieldset>
      <fieldset id="oauthFields" class="add-grid" hidden disabled>
        <label class="wide">Authorization URL<input id="liveAuthorizationURL" type="url"></label>
        <label class="wide">Token URL<input id="liveTokenURL" type="url"></label>
        <label>Client ID<input id="liveClientID"></label>
        <label>Scopes<input id="liveScopes" placeholder="read search"></label>
        <label class="wide">Revocation URL (optional)<input id="liveRevocationURL" type="url"></label>
        <div class="wide muted">Leave endpoints and client ID blank for discovery and public client registration. Register <code id="liveCallback"></code> as the OAuth redirect URL when configuring manually.</div>
      </fieldset>
      <fieldset id="sparkFields" class="add-grid" hidden disabled>
        <label class="wide">Spark CLI path<input id="liveCommand" value="/usr/local/bin/spark" required pattern="/.*"></label>
        <div class="wide muted">Use the Spark CLI installed on this Mac and sign in there first. Available tools follow your installed Spark CLI and account access settings, including mail, attachments, drafts, actions, calendar, contacts, and teams.</div>
      </fieldset>
      <details id="liveAdvanced"><summary>Advanced connector JSON</summary><div class="muted">Optional full manifest for CLI argument templates, incremental indexing, and advanced MCP options. Leave blank to use the form. Keep credentials out of this editor.</div><textarea id="liveManifest" aria-label="Connector manifest JSON" style="min-height:180px"></textarea></details>
      <div id="liveBearerHelp" class="muted" hidden>After saving, enter your token in the connector card and choose Connect. Tokens are stored separately from connector configuration.</div>
      <div class="actions" style="margin-top:14px"><button id="saveLive" type="submit">Save connector</button><button id="cancelLiveEdit" type="button" class="secondary" hidden>Cancel edit</button></div>
    </fieldset>
    <div id="liveFormStatus" class="muted" role="status" style="margin-top:10px"></div>
  </form>

  <h2 id="local-connectors">Imported records</h2>
  <div class="muted">Import account exports into the private local index. Records are searchable by every model and never pass through Dia.</div>
  <div class="card">
    <div class="row profile-row"><label for="connectorProfile">Dia profile</label><select id="connectorProfile" data-profile-select disabled><option value="Default">Loading profiles…</option></select></div>
    <div class="add-grid" style="margin-top:10px">
      <label>Import ID<input id="connectorID" placeholder="contacts"></label>
      <label>Display name<input id="connectorLabel" placeholder="Contacts"></label>
      <label class="wide">JSON export<input id="connectorFile" type="file" accept="application/json,.json"></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button id="importConnector">Import JSON</button>
      <span id="connectorStatus" class="muted"></span>
    </div>
    <div id="connectorList" style="margin-top:12px"></div>
    <div class="muted" style="margin-top:10px">JSON may be an array of records or <code>{ records: [...] }</code>. Each record can contain <code>id</code>, <code>title</code>/<code>name</code>, <code>content</code>, <code>url</code>, <code>updatedAt</code>, and <code>kind: "person"</code>.</div>
  </div>

  </section>
  <section class="settings-panel" id="panel-knowledge" role="tabpanel" aria-labelledby="tab-knowledge" tabindex="0" hidden>
  <h2 id="knowledge-workflows">Knowledge &amp; research</h2>
  <div class="muted">Keep source documents and research in a local index for each profile. Research uses read-only tools and sends relevant sources to your selected AI provider.</div>
  <div class="card">
    <div class="row profile-row"><label for="workflowProfile">Dia profile</label><select id="workflowProfile" data-profile-select disabled><option value="Default">Loading profiles…</option></select><button id="refreshWorkflows" class="secondary">Refresh</button></div>
    <div id="workflowStatus" class="muted" role="status" style="margin:10px 0"></div>
    <h3>Import a source</h3>
    <form id="knowledgeForm" class="add-grid">
      <label>Document title<input id="knowledgeTitle" required maxlength="200"></label>
      <label>Source URL (optional)<input id="knowledgeURL" type="url" placeholder="https://example.com/source"></label>
      <label class="wide">Document text<textarea id="knowledgeContent" style="min-height:140px" placeholder="Paste text or choose a .txt/.md file. Leave blank to fetch the source URL."></textarea></label>
      <label class="wide">Text file (optional)<input id="knowledgeFile" type="file" accept=".txt,.md,text/plain,text/markdown"></label>
      <div class="wide"><button type="submit">Import document</button></div>
    </form>
    <div id="knowledgeList" style="margin-top:14px"></div>
  </div>
  <div class="card">
    <h3>Research &amp; automations</h3>
    <form id="researchForm" class="add-grid">
      <label class="wide">Title<input id="researchTitle" required maxlength="200" placeholder="Research topic or recurring brief"></label>
      <label class="wide">Research request<textarea id="researchPrompt" required style="min-height:140px" placeholder="Explain the topic, questions to answer, and sources to use."></textarea></label>
      <label>Repeat every (minutes)<input id="workflowInterval" type="number" min="5" max="525600" value="1440"></label>
      <label><span>Schedule</span><span><input id="workflowEnabled" type="checkbox"> Enable recurring runs</span></label>
      <div class="wide actions"><button id="researchNow" type="submit">Research now</button><button id="saveWorkflow" type="button" class="secondary">Save automation</button></div>
    </form>
    <div class="muted" style="margin-top:10px">Automations run while Dia+ is open. Missed intervals are skipped. New schedules stay disabled until you enable them.</div>
    <div id="workflowList"></div>
    <div id="researchRuns"></div>
  </div>

  </section>
  <section class="settings-panel" id="panel-memory" role="tabpanel" aria-labelledby="tab-memory" tabindex="0" hidden>
  <h2 id="local-memory">Local memory</h2>
  <div class="muted">Browsing, chat evidence, and derived Memories stay in an owner-only SQLite database on this Mac. The selected model derives durable context; semantic matching uses Apple's on-device sentence embeddings when available. Nothing is sent to Dia.</div>
  <div class="card">
    <div class="row"><label><input id="memoryEnabled" type="checkbox" role="switch" disabled> Enable local Memory</label></div>
    <p class="muted">Disabling stops Memory recall, activity import, chat capture and model-based derivation without deleting saved entries. These controls do not require Dia's native Memory settings pane.</p>
    <div class="row" style="margin:14px 0"><label for="memoryRetention">Default activity retention (days)</label><input id="memoryRetention" type="number" min="1" max="3650" disabled><button id="saveMemoryRetention" class="secondary" disabled>Save retention</button></div>
    <p class="muted">Existing per-profile retention overrides are preserved. Saving applies retention immediately and may delete older activity.</p>
    <div id="memoryControlsStatus" class="muted" role="status" style="margin:10px 0"></div>
    <div id="memoryStats" class="memory-grid"></div>
    <div class="actions">
      <button id="exportMemory" class="secondary">Export JSON</button>
      <button id="pruneMemory" class="secondary">Apply retention</button>
      <button data-memory-type="conversation" class="danger">Delete chats</button>
      <button data-memory-type="navigation" class="danger">Delete browsing</button>
      <button data-memory-all="true" class="danger">Delete all</button>
    </div>
    <div id="memoryStatus" class="muted" style="margin-top:10px"></div>
  </div>

  </section>
  <section class="settings-panel" id="panel-updates" role="tabpanel" aria-labelledby="tab-updates" tabindex="0" hidden>
  <h2 id="custom-updater">Custom updater</h2>
  <div class="muted">Official releases are downloaded and rebuilt with every enabled mod. Installation restarts Dia+ and preserves an app and profile rollback point.</div>
  <div class="card">
    <div id="githubUpdateStatus" role="status">GitHub sign-in is optional. Repository access is required only for updates.</div>
    <div class="actions" style="margin:10px 0"><button id="githubUpdateSignIn" class="secondary">Sign in with GitHub</button><button id="githubUpdateSignOut" class="secondary" hidden>Sign out</button><button id="githubUpdateCancel" class="secondary" hidden>Cancel sign-in</button></div>
    <div id="githubUpdateChallenge" hidden><a id="githubUpdateLink" href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">Open GitHub to authorize</a> · Enter code <code id="githubUpdateCode"></code>. Credentials are entered only on GitHub.</div>
    <label for="updateChannel">Update channel</label> <select id="updateChannel"><option value="stable">Stable</option><option value="beta">Beta — includes prereleases</option></select>
    <p class="muted">Without repository access, Dia+ still works. Use a self-contained installer ZIP shared by the owner for manual updates.</p>
    <div id="updaterStatus" role="status">Loading updater…</div>
    <div id="updaterDetail" class="muted" style="margin:10px 0"></div>
    <div id="updaterProgress" class="update-progress" hidden><progress id="updaterProgressBar" max="100" value="0" aria-label="Update download progress"></progress><div id="updaterProgressText" class="muted"></div></div>
    <div id="updaterCompatibility" class="update-review" hidden></div>
    <div class="actions"><button id="checkUpdate">Check for updates</button><button id="prepareUpdate" class="secondary" disabled>Update mods — download &amp; validate</button><button id="prepareDiaUpdate" class="secondary" disabled>Update Dia + mods — download &amp; validate</button><button id="continueUpdate" class="secondary" hidden disabled>Continue and disable incompatible mods</button><button id="installUpdate" disabled>Install &amp; restart</button></div>
  </div>

  </section>
  <section class="settings-panel" id="panel-advanced" role="tabpanel" aria-labelledby="tab-advanced" tabindex="0" hidden>
  <h2 id="advanced-json">Advanced JSON</h2>
  <div class="muted">Use this editor for provider aliases, endpoint details, and memory retention. Dia-owned endpoint URLs are always rejected.</div>
  <div class="card">
    <textarea id="config" spellcheck="false" aria-label="Provider configuration"></textarea>
    <div class="row" style="margin-top:10px">
      <button id="save">Save configuration</button>
      <span id="saveStatus" class="muted"></span>
    </div>
  </div>

  <h2 id="tool-coverage">Tool coverage</h2>
  <div class="muted">This inventory updates whenever Dia sends a chat request. Native tools return to Dia's browser harness; local tools execute in the localhost bridge.</div>
  <div class="card">
    <div id="toolSummary" class="muted"></div>
    <div id="toolList" style="margin-top:10px"></div>
  </div>

  </section>
  </main>

  <script>
    const token = ${token};
    const modelSelect = document.querySelector('#models');
    const status = document.querySelector('#status');
    const editor = document.querySelector('#config');
    const saveStatus = document.querySelector('#saveStatus');
    const providerList = document.querySelector('#providerList');
    const providerStatus = document.querySelector('#providerStatus');
    const memoryStats = document.querySelector('#memoryStats');
    const memoryStatus = document.querySelector('#memoryStatus');
    const connectorList = document.querySelector('#connectorList');
    const connectorStatus = document.querySelector('#connectorStatus');
    const toolSummary = document.querySelector('#toolSummary');
    const toolList = document.querySelector('#toolList');
    const modList = document.querySelector('#modList');
    const modNotice = document.querySelector('#modNotice');
    const modStatus = document.querySelector('#modStatus');

    async function request(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'content-type': 'application/json', 'x-dia-custom-token': token, ...(options.headers || {}) },
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || ('HTTP ' + response.status));
      return value;
    }

    async function load(force = false) {
      status.textContent = 'Discovering available models…';
      status.className = 'muted';
      try {
        const [catalog, config, memory, credentials, toolData, modData] = await Promise.all([
          request('/api/models' + (force ? '?refresh=1' : '')),
          request('/api/config'),
          request('/api/memory'),
          request('/api/credentials'),
          request('/api/tools'),
          request('/api/mods'),
        ]);
        modelSelect.replaceChildren();
        for (const provider of catalog.providers) {
          const group = document.createElement('optgroup');
          group.label = provider.label;
          for (const model of catalog.models.filter(item => item.providerID === provider.id)) {
            const option = document.createElement('option');
            option.value = model.key;
            option.textContent = model.label + (model.available ? '' : ' — unavailable');
            option.disabled = !model.available;
            option.title = model.reason || model.description || '';
            option.selected = model.key === catalog.selectedModel;
            group.append(option);
          }
          if (group.children.length) modelSelect.append(group);
        }
        editor.value = JSON.stringify(config, null, 2);
        const selected = catalog.models.find(item => item.key === catalog.selectedModel);
        status.textContent = selected
          ? (selected.providerLabel + ' · ' + selected.label + (selected.reason ? ' · ' + selected.reason : ''))
          : ('Configured selection: ' + catalog.selectedModel);
        const navigation = memory.entryTypes.navigation?.count || 0;
        const conversations = memory.entryTypes.conversation?.count || 0;
        const derivedMemories = memory.entryTypes.memory?.count || 0;
        const connectorEntries = memory.entryTypes.connector?.count || 0;
        memoryStats.innerHTML = '';
        for (const item of [
          [memory.total, 'Total entries'],
          [derivedMemories, 'Derived Memories'],
          [navigation, 'Browsing'],
          [conversations, 'Chats'],
          [connectorEntries, 'Connector records'],
          [memory.embedded, 'Semantically indexed'],
          [memory.semanticAvailable ? 'On' : 'Off', 'On-device semantics'],
        ]) {
          const box = document.createElement('div');
          box.className = 'stat';
          const value = document.createElement('strong');
          value.textContent = String(item[0]);
          const label = document.createElement('span');
          label.textContent = item[1];
          box.append(value, label);
          memoryStats.append(box);
        }
        memoryStatus.textContent = memory.semanticError || '';
        modNotice.textContent = modData.rebuildRequired
          ? 'A clean Dia+ rebuild is required to apply pending changes.'
          : modData.restartRequired
            ? 'Restart Dia+ to apply pending changes.'
            : modData.unavailableMods?.length
              ? modData.unavailableMods.length + ' configured mod(s) are temporarily unavailable for this Dia build.'
              : 'All configured mods are active.';
        modList.replaceChildren();
        for (const mod of modData.mods) {
          const row = document.createElement('div');
          row.className = 'mod';
          const copy = document.createElement('div');
          const title = document.createElement('div');
          title.className = 'mod-title';
          title.textContent = mod.label;
          const description = document.createElement('div');
          description.className = 'muted';
          description.textContent = mod.description;
          const meta = document.createElement('div');
          meta.className = 'muted mod-meta';
          meta.textContent = mod.unavailable ? 'Temporarily unavailable · ' + mod.compatibilityReason : mod.required
            ? 'Required safety/core mod'
            : (mod.rebuildOnChange ? 'Changes require a rebuild' : 'Changes apply after restart') +
              (mod.requiresStableSignature ? ' · stable signing required' : '') +
              (mod.pending ? ' · change pending' : '');
          copy.append(title, description, meta);
          if (mod.privacyNotice) {
            const privacy = document.createElement('div');
            privacy.className = 'muted mod-meta';
            privacy.textContent = 'Privacy: ' + mod.privacyNotice;
            copy.append(privacy);
          }
          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = mod.configuredEnabled;
          toggle.disabled = mod.required || mod.unavailable;
          toggle.setAttribute('role', 'switch');
          toggle.setAttribute('aria-label', 'Enable ' + mod.label);
          toggle.addEventListener('change', async () => {
            const wanted = toggle.checked;
            toggle.disabled = true;
            modStatus.textContent = 'Saving ' + mod.label + '…';
            try {
              await request('/api/mods/' + encodeURIComponent(mod.id), {
                method: 'PUT', body: JSON.stringify({ enabled: wanted }),
              });
              modStatus.textContent = mod.rebuildOnChange
                ? 'Saved. Rebuild Dia+ to apply this change.'
                : 'Saved. Restart Dia+ to apply this change.';
              await load();
            } catch (error) {
              toggle.checked = !wanted;
              toggle.disabled = mod.required || mod.unavailable;
              modStatus.textContent = error.message;
              modStatus.className = 'error';
            }
          });
          row.append(copy, toggle);
          modList.append(row);
        }
        toolSummary.textContent = toolData.total + ' seen · ' + toolData.native + ' native · ' + toolData.local + ' local · ' + toolData.deferred + ' on-demand · ' + toolData.blocked + ' blocked';
        toolList.replaceChildren();
        for (const tool of toolData.tools) {
          const line = document.createElement('div');
          line.className = 'provider-title';
          const name = document.createElement('code');
          name.textContent = tool.name;
          const route = document.createElement('span');
          route.className = 'muted';
          route.textContent = tool.route === 'blocked'
            ? 'blocked (Dia-owned service)'
            : tool.route === 'deferred'
              ? 'native on-demand'
            : tool.route + (tool.nativeSeen && tool.route === 'local' ? ' override' : '');
          line.append(name, route);
          toolList.append(line);
        }
        providerList.replaceChildren();
        for (const provider of config.providers.filter(item => item.type === 'openai-compatible')) {
          const wrapper = document.createElement('div');
          wrapper.className = 'provider';
          const heading = document.createElement('div');
          heading.className = 'provider-title';
          const title = document.createElement('strong');
          title.textContent = provider.label + ' · ' + provider.id;
          const credential = document.createElement('span');
          credential.className = 'muted';
          credential.textContent = credentials[provider.id]?.configured
            ? 'Credential set (' + credentials[provider.id].source + ')'
            : 'No credential';
          heading.append(title, credential);
          const endpoint = document.createElement('div');
          endpoint.className = 'muted';
          endpoint.textContent = provider.baseURL;
          const keyRow = document.createElement('div');
          keyRow.className = 'row';
          const key = document.createElement('input');
          key.type = 'password';
          key.autocomplete = 'new-password';
          key.placeholder = 'Set or replace API key';
          key.setAttribute('aria-label', 'API key for ' + provider.label);
          const saveKey = document.createElement('button');
          saveKey.textContent = 'Save key';
          saveKey.addEventListener('click', async () => {
            providerStatus.textContent = 'Saving credential…';
            try {
              await request('/api/credentials/' + encodeURIComponent(provider.id), {
                method: 'PUT', body: JSON.stringify({ secret: key.value }),
              });
              key.value = '';
              providerStatus.textContent = 'Credential saved.';
              await load(true);
            } catch (error) { providerStatus.textContent = error.message; providerStatus.className = 'error'; }
          });
          const clearKey = document.createElement('button');
          clearKey.className = 'secondary';
          clearKey.textContent = 'Clear key';
          clearKey.disabled = !credentials[provider.id]?.configured;
          clearKey.addEventListener('click', async () => {
            await request('/api/credentials/' + encodeURIComponent(provider.id), { method: 'DELETE' });
            await load(true);
          });
          keyRow.append(key, saveKey, clearKey);
          const modelRow = document.createElement('div');
          modelRow.className = 'row';
          const model = document.createElement('input');
          model.placeholder = 'Add model ID or alias';
          model.setAttribute('aria-label', 'Model ID for ' + provider.label);
          const addModel = document.createElement('button');
          addModel.className = 'secondary';
          addModel.textContent = 'Add model';
          addModel.addEventListener('click', async () => {
            const id = model.value.trim();
            if (!id) return;
            const value = JSON.parse(editor.value);
            const target = value.providers.find(item => item.id === provider.id);
            if (!target.models.some(item => item.id === id)) target.models.push({ id, label: id, description: 'Configured alias' });
            await request('/api/config', { method: 'PUT', body: JSON.stringify(value) });
            await load(true);
          });
          modelRow.append(model, addModel);
          wrapper.append(heading, endpoint, keyRow, modelRow);
          providerList.append(wrapper);
        }
        for (const provider of config.providers.filter(item => item.type === 'apple-foundation-models')) {
          const wrapper = document.createElement('div'); wrapper.className = 'provider';
          const title = document.createElement('strong'); title.textContent = provider.label;
          const label = document.createElement('label'); label.textContent = 'Image analysis '; label.className = 'row';
          const select = document.createElement('select'); select.setAttribute('aria-label', 'Apple image analysis');
          for (const [value, text] of [['vision','Local Vision / OCR (default)'],['native','Native Apple vision (experimental)']]) {
            const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = (provider.imageMode || 'vision') === value; select.append(option);
          }
          const feedback = document.createElement('div'); feedback.className = 'muted';
          feedback.textContent = 'Local Vision supplies recognized text and image measurements. Native vision depends on the installed Apple model.';
          select.addEventListener('change', async () => {
            try { const value = JSON.parse(editor.value); value.providers.find(item => item.id === provider.id).imageMode = select.value; await request('/api/config', { method: 'PUT', body: JSON.stringify(value) }); await load(); }
            catch(error) { feedback.textContent = error.message; }
          });
          label.append(select); wrapper.append(title, label, feedback); providerList.append(wrapper);
        }
        await memoryControls.refresh();
      } catch (error) {
        status.textContent = error.message;
        status.className = 'error';
      }
    }

    let importedRevision = 0;
    async function loadImportedConnectors() {
      const revision = ++importedRevision;
      const profileID = document.querySelector('#connectorProfile').value;
      try {
        const connectorData = await request('/api/connectors?profileID=' + encodeURIComponent(profileID));
        if (revision !== importedRevision) return;
        connectorList.replaceChildren();
        if (!connectorData.connectors.length) {
          const empty = document.createElement('div');
          empty.className = 'muted';
          empty.textContent = 'No account exports imported yet.';
          connectorList.append(empty);
        }
        for (const connector of connectorData.connectors) {
          const row = document.createElement('div');
          row.className = 'provider-title';
          const details = document.createElement('span');
          details.textContent = connector.label + ' · ' + connector.itemCount + ' records';
          const remove = document.createElement('button');
          remove.className = 'danger';
          remove.textContent = 'Remove';
          remove.addEventListener('click', async () => {
            if (!confirm('Remove all locally imported records for ' + connector.label + '?')) return;
            await request('/api/connectors/' + encodeURIComponent(connector.id) + '?profileID=' + encodeURIComponent(profileID), { method: 'DELETE' });
            await loadImportedConnectors();
          });
          row.append(details, remove);
          connectorList.append(row);
        }

      } catch (error) { if (revision === importedRevision) connectorStatus.textContent = error.message; }
    }

    document.querySelector('#select').addEventListener('click', async () => {
      status.textContent = 'Saving selection…';
      try {
        await request('/api/selection', { method: 'PUT', body: JSON.stringify({ model: modelSelect.value }) });
        await load();
      } catch (error) { status.textContent = error.message; status.className = 'error'; }
    });
    document.querySelector('#refresh').addEventListener('click', () => load(true));
    document.querySelector('#save').addEventListener('click', async () => {
      saveStatus.textContent = 'Saving…';
      saveStatus.className = 'muted';
      try {
        const value = JSON.parse(editor.value);
        await request('/api/config', { method: 'PUT', body: JSON.stringify(value) });
        saveStatus.textContent = 'Saved.';
        await load(true);
      } catch (error) { saveStatus.textContent = error.message; saveStatus.className = 'error'; }
    });
    document.querySelector('#addProvider').addEventListener('click', async () => {
      providerStatus.textContent = 'Adding provider…';
      providerStatus.className = 'muted';
      try {
        const value = JSON.parse(editor.value);
        const id = document.querySelector('#newProviderID').value.trim();
        const label = document.querySelector('#newProviderLabel').value.trim() || id;
        const baseURL = document.querySelector('#newProviderURL').value.trim();
        const discoveryURL = document.querySelector('#newProviderDiscovery').value.trim() || null;
        const models = document.querySelector('#newProviderModels').value.split(',').map(item => item.trim()).filter(Boolean).map(model => ({ id: model, label: model, description: 'Configured alias' }));
        value.providers.push({
          id, label, type: 'openai-compatible', enabled: true,
          api: document.querySelector('#newProviderAPI').value,
          baseURL, discoveryURL, apiKeyEnv: null, models,
        });
        await request('/api/config', { method: 'PUT', body: JSON.stringify(value) });
        providerStatus.textContent = 'Provider added.';
        await load(true);
      } catch (error) { providerStatus.textContent = error.message; providerStatus.className = 'error'; }
    });
    document.querySelector('#connectorProfile').addEventListener('change', loadImportedConnectors);
    document.querySelector('#importConnector').addEventListener('click', async () => {
      connectorStatus.textContent = 'Importing locally…';
      connectorStatus.className = 'muted';
      try {
        const file = document.querySelector('#connectorFile').files[0];
        if (!file) throw new Error('Choose a JSON export first.');
        const value = JSON.parse(await file.text());
        const records = Array.isArray(value) ? value : (value.records || value.entries);
        const id = document.querySelector('#connectorID').value.trim() || value.id;
        const label = document.querySelector('#connectorLabel').value.trim() || value.label || id;
        const result = await request('/api/connectors/import', {
          method: 'POST',
          body: JSON.stringify({ id, label, records, replace: true, profileID: document.querySelector('#connectorProfile').value.trim() }),
        });
        connectorStatus.textContent = 'Imported ' + result.imported + ' records.';
        await loadImportedConnectors();
      } catch (error) { connectorStatus.textContent = error.message; connectorStatus.className = 'error'; }
    });
    document.querySelector('#exportMemory').addEventListener('click', async () => {
      memoryStatus.textContent = 'Preparing export…';
      try {
        const response = await fetch('/api/memory/export', {
          headers: { 'x-dia-custom-token': token },
        });
        if (!response.ok) throw new Error((await response.json()).error || ('HTTP ' + response.status));
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'dia-custom-memory-' + new Date().toISOString().slice(0, 10) + '.json';
        link.click();
        URL.revokeObjectURL(link.href);
        memoryStatus.textContent = 'Exported.';
      } catch (error) { memoryStatus.textContent = error.message; memoryStatus.className = 'error'; }
    });
    document.querySelector('#pruneMemory').addEventListener('click', async () => {
      memoryStatus.textContent = 'Applying retention…';
      try {
        const value = await request('/api/memory/prune', { method: 'POST', body: '{}' });
        memoryStatus.textContent = 'Retention applied; deleted ' + value.deleted + ' entries.';
        await load();
      } catch (error) { memoryStatus.textContent = error.message; memoryStatus.className = 'error'; }
    });
    for (const button of document.querySelectorAll('[data-memory-type], [data-memory-all]')) {
      button.addEventListener('click', async () => {
        const label = button.dataset.memoryAll ? 'all local memory' : button.textContent.toLowerCase();
        if (!confirm('Permanently ' + label + '? This cannot be undone.')) return;
        memoryStatus.textContent = 'Deleting…';
        try {
          const body = button.dataset.memoryAll
            ? { all: true }
            : { entryTypes: [button.dataset.memoryType] };
          const value = await request('/api/memory', { method: 'DELETE', body: JSON.stringify(body) });
          memoryStatus.textContent = 'Deleted ' + value.deleted + ' entries.';
          await load();
        } catch (error) { memoryStatus.textContent = error.message; memoryStatus.className = 'error'; }
      });
    }
    (${initializeUpdaterSettings.toString()})({ document, request });
    const memoryControls = (${initializeMemorySettings.toString()})({ document, request, onChange: () => load() });
    (${initializeMediaSettings.toString()})({ document, request });
    (${initializeSettingsNavigation.toString()})({ document, window });
    const profiles = (${initializeProfileSettings.toString()})({ document, request, window });
    profiles.ready.then(() => {
      (${initializeConnectorSettings.toString()})({ document, request });
      (${initializeWorkflowSettings.toString()})({ document, request });
      loadImportedConnectors();
      load();
    }).catch(error => { status.textContent = error.message; status.className = 'error'; load(); });
  </script>
</body>
</html>`;
}

// These controllers are embedded in the page; keep them self-contained.
export function initializeMemorySettings({ document, request, onChange = async () => {}, confirmRetention = message => globalThis.confirm(message) }) {
  const enabled = document.querySelector('#memoryEnabled');
  const retention = document.querySelector('#memoryRetention');
  const save = document.querySelector('#saveMemoryRetention');
  const status = document.querySelector('#memoryControlsStatus');
  let state = null;
  let busy = false;
  function render() {
    enabled.checked = state?.enabled === true;
    retention.value = state ? String(state.retentionDays) : '';
    for (const control of [enabled, retention, save]) control.disabled = busy || state?.modEnabled !== true;
  }
  async function refresh() {
    if (busy) return;
    busy = true; render();
    try {
      state = await request('/api/memory/enabled');
      status.textContent = state.modEnabled === true
        ? (state.enabled ? 'Local Memory is enabled.' : 'Local Memory is paused; saved entries are retained.')
        : 'Enable the Local Memory mod and restart Dia+ to use these controls.';
      status.className = 'muted';
    } catch (error) {
      state = null;
      status.textContent = error.message;
      status.className = 'error';
    } finally { busy = false; render(); }
  }
  async function mutate(path, body, retentionChange = false) {
    if (busy || state?.modEnabled !== true) { render(); return; }
    busy = true;
    for (const control of [enabled, retention, save]) control.disabled = true;
    let succeeded = false;
    try {
      const result = await request(path, { method: 'PUT', body: JSON.stringify(body) });
      state = { ...state, ...(retentionChange ? result.localMemory : result) };
      status.textContent = retentionChange ? 'Retention saved and applied.'
        : state.enabled ? 'Local Memory is enabled.' : 'Local Memory is paused; saved entries are retained.';
      status.className = 'muted';
      succeeded = true;
    } catch (error) { status.textContent = error.message; status.className = 'error'; }
    finally { busy = false; render(); }
    if (succeeded) await onChange();
  }
  enabled.addEventListener('change', () => mutate('/api/memory/enabled', { enabled: enabled.checked }));
  save.addEventListener('click', async () => {
    if (busy || state?.modEnabled !== true) return;
    const days = Number(retention.value);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      status.textContent = 'Enter a whole number of days from 1 to 3650.'; status.className = 'error'; return;
    }
    if (!confirmRetention('Apply this retention period now? Older activity may be permanently deleted. Per-profile overrides will be kept.')) return;
    await mutate('/api/memory/retention', { retentionDays: days }, true);
  });
  render();
  return { refresh };
}

export function initializeSettingsNavigation({ document, window }) {
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];
  const aliases = {
    'model-selection': 'models', 'provider-configuration': 'models', 'add-provider': 'models',
    'dia-mods': 'mods', 'live-connectors': 'connections', 'local-connectors': 'connections',
    'knowledge-workflows': 'knowledge', 'local-memory': 'memory', 'custom-updater': 'updates',
    'advanced-json': 'advanced', 'tool-coverage': 'advanced',
  };
  const valid = id => tabs.some(tab => tab.dataset.settingsTab === id);
  let active = 'models';
  function select(id, { focus = false, updateURL = false } = {}) {
    if (!valid(id)) id = 'models';
    active = id;
    for (const tab of tabs) {
      const selected = tab.dataset.settingsTab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.id !== 'panel-' + id;
    try { window.localStorage.setItem('dia-mod-settings-tab', id); } catch { /* Storage can be unavailable in private windows. */ }
    if (updateURL) { window.history.pushState(null, '', '#' + id); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }
  function fromURL() {
    const fragment = window.location.hash.slice(1);
    let saved;
    try { saved = window.localStorage.getItem('dia-mod-settings-tab'); } catch {}
    select(aliases[fragment] || (valid(fragment) ? fragment : fragment ? 'models' : saved));
    if (aliases[fragment]) document.getElementById(fragment)?.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab.dataset.settingsTab, { updateURL: true }));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[next].dataset.settingsTab, { focus: true, updateURL: true });
    });
  }
  window.addEventListener('hashchange', fromURL);
  window.addEventListener('popstate', fromURL);
  fromURL();
  return { select, get active() { return active; } };
}

export function initializeProfileSettings({ document, request, window }) {
  const selects = [...document.querySelectorAll('[data-profile-select]')];
  const notice = document.querySelector('#profileStatus');
  let syncing = false;
  let allowed = new Set();
  const remember = id => { try { window.localStorage.setItem('dia-mod-settings-profile', id); } catch {} };
  for (const select of selects) select.addEventListener('change', () => {
    if (syncing || !allowed.has(select.value)) return;
    syncing = true;
    try {
      remember(select.value);
      for (const other of selects) {
        if (other === select || other.value === select.value) continue;
        other.value = select.value;
        other.dispatchEvent(new window.Event('change', { bubbles: true }));
      }
    } finally { syncing = false; }
  });
  async function refresh() {
    try {
      const value = await request('/api/profiles');
      const profiles = value.profiles || [];
      if (!profiles.length) throw new Error('No Dia profiles are available yet. Open a browser window, then reload settings.');
      allowed = new Set(profiles.map(profile => profile.id));
      let saved;
      try { saved = window.localStorage.getItem('dia-mod-settings-profile'); } catch {}
      const selected = allowed.has(saved) ? saved : allowed.has(value.selectedProfileID) ? value.selectedProfileID : profiles[0].id;
      for (const select of selects) {
        select.replaceChildren();
        for (const profile of profiles) {
          const option = document.createElement('option');
          option.value = profile.id;
          option.textContent = profile.name;
          select.append(option);
        }
        select.value = selected;
        select.disabled = false;
      }
      remember(selected);
      notice.textContent = '';
      return selected;
    } catch (error) {
      for (const select of selects) select.disabled = true;
      const importButton = document.querySelector('#importConnector');
      if (importButton) importButton.disabled = true;
      notice.textContent = error.message;
      notice.className = 'error';
      throw error;
    }
  }
  return { ready: refresh() };
}

// This controller is embedded in the page and can also run against a small DOM
// harness in tests. Keep it self-contained: no module-scope dependencies.
export function initializeConnectorSettings({ document, request, confirm = globalThis.confirm, window = globalThis.window }) {
  const field = (id) => document.querySelector('#' + id);
  const form = field('liveConnectorForm');
  const profile = field('liveProfile');
  const list = field('liveList');
  const nativeList = field('nativeConnectorList');
  const notice = field('liveNotice');
  const status = field('liveStatus');
  const formStatus = field('liveFormStatus');
  let editing = null;
  let revision = 0;
  let enabled = true;
  let savedIDs = new Set();
  let hostsEdited = false;
  let retryTimer;
  const message = (node, text, error = false) => {
    node.textContent = text;
    node.className = error ? 'error' : 'muted';
  };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const selectedProfile = () => {
    const value = profile.value.trim();
    if (!/^[^/\\\0]{1,120}$/.test(value)) throw new Error('Choose a valid Dia profile.');
    return value;
  };
  function updateFields() {
    const spark = field('liveType').value === 'spark-cli';
    const local = ['stdio', 'cli'].includes(field('liveType').value);
    const oauth = !spark && !local && field('liveAuthentication').value === 'oauth';
    const advanced = Boolean(field('liveManifest').value.trim());
    field('liveID').required = !advanced; field('liveName').required = !advanced;
    for (const [id, visible] of [['mcpFields', !spark && !local], ['oauthFields', oauth], ['sparkFields', spark], ['processFields', local]]) {
      field(id).hidden = !visible;
      field(id).disabled = !visible || advanced;
    }
    field('liveBearerHelp').hidden = spark || field('liveAuthentication').value !== 'bearer';
  }
  function resetForm() {
    form.reset();
    editing = null;
    hostsEdited = false;
    field('liveID').disabled = false;
    field('liveType').disabled = false;
    field('liveFormTitle').textContent = 'Add a live connector';
    field('cancelLiveEdit').hidden = true;
    updateFields();
  }
  function edit(connector) {
    editing = connector;
    hostsEdited = true;
    field('liveID').value = connector.id;
    field('liveID').disabled = true;
    field('liveType').value = connector.transport === 'streamable-http' ? 'mcp' : connector.transport;
    field('liveType').disabled = true;
    field('liveName').value = connector.displayName;
    field('processCommand').value = connector.command || '';
    field('processArgs').value = JSON.stringify(connector.args || []);
    field('processCwd').value = connector.cwd || '';
    field('processEnv').value = (connector.envKeys || []).join(', ');
    field('liveManifest').value = connector.transport === 'cli' || connector.sync ? JSON.stringify(connector.manifest || Object.fromEntries(Object.entries(connector).filter(([key]) => ['id','displayName','execution','transport','authentication','command','args','cwd','envKeys','tools','sync','endpoint','allowedDomains','oauth'].includes(key))), null, 2) : '';
    field('liveEndpoint').value = connector.endpoint || '';
    field('liveHosts').value = (connector.allowedDomains || []).join(', ');
    field('liveAuthentication').value = connector.authentication;
    field('liveCommand').value = connector.command || '/usr/local/bin/spark';
    field('liveAuthorizationURL').value = connector.oauth?.authorizationURL || '';
    field('liveTokenURL').value = connector.oauth?.tokenURL || '';
    field('liveClientID').value = connector.oauth?.clientID || '';
    field('liveScopes').value = (connector.oauth?.scopes || []).join(' ');
    field('liveRevocationURL').value = connector.oauth?.revocationURL || '';
    field('liveFormTitle').textContent = 'Edit ' + connector.displayName;
    field('cancelLiveEdit').hidden = false;
    message(formStatus, 'Saving changes disconnects this connector in every profile. Connect it again after saving.');
    updateFields();
    form.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  function renderConnector(connector, profileID) {
    const row = element('div', undefined, 'provider');
    const title = element('div', undefined, 'provider-title');
    const ready = connector.connected && connector.executionReady;
    const state = connector.connectionState || (ready ? 'connected' : connector.connected ? 'error' : 'disconnected');
    const labels = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', 'auth-required': 'Sign-in needed', error: 'Needs attention' };
    const badge = element('span', labels[state] || 'Needs attention', 'connection-badge');
    badge.setAttribute('data-state', state);
    title.append(element('strong', connector.displayName), badge);
    row.append(title);
    const tools = Array.isArray(connector.tools) ? connector.tools : connector.capabilities || [];
    const toolCount = connector.toolCount ?? tools.length;
    row.append(element('div', connector.id + ' · ' + (connector.command || connector.endpoint || 'Browser session') + (connector.accountLabel ? ' · ' + connector.accountLabel : ''), 'muted connector-meta'));
    if (connector.schemaAvailable || toolCount) row.append(element('div', toolCount + (toolCount === 1 ? ' tool available' : ' tools available'), 'muted'));
    if (connector.lastError) row.append(element('div', connector.lastError, 'error connector-meta'));
    if (connector.desiredConnected && !ready) row.append(element('div', state === 'auth-required' ? 'Reconnect to finish sign-in. Your connection preference is saved.' : 'Your connection preference is saved. Dia will retry when the connector is available.', 'muted connector-meta'));
    if (connector.execution !== 'bridge') {
      row.append(element('div', 'Manage this account in Dia’s Apps settings.', 'muted'));
      return row;
    }
    const actions = element('div', undefined, 'actions');
    const feedback = element('div', undefined, 'muted connector-meta');
    feedback.setAttribute('role', 'status');
    let secret = null;
    if (connector.authentication === 'bearer') {
      secret = element('input');
      secret.type = 'password';
      secret.autocomplete = 'new-password';
      secret.placeholder = connector.authenticated ? 'Replacement token (optional)' : 'Bearer token';
      secret.setAttribute('aria-label', 'Bearer token for ' + connector.displayName);
      row.append(secret);
    }
    const environment = {};
    for (const key of connector.envKeys || []) {
      const input = element('input'); input.type = 'password'; input.placeholder = key + (connector.connected ? ' (replacement optional)' : ''); input.setAttribute('aria-label', key + ' for ' + connector.displayName); row.append(input); environment[key] = input;
    }
    function button(label, action, className = 'secondary', disabled = false) {
      const node = element('button', label, className);
      node.type = 'button';
      node.disabled = disabled;
      node.addEventListener('click', async () => {
        node.disabled = true;
        message(feedback, label + '…');
        message(status, '');
        field('liveAuthLink').replaceChildren();
        try {
          await action();
        } catch (error) {
          message(feedback, error.message, true);
        } finally {
          node.disabled = disabled;
        }
      });
      actions.append(node);
    }
    button(connector.connected ? 'Reconnect' : 'Connect', async () => {
      if (secret && !secret.value.trim() && !connector.authenticated) throw new Error('Enter a bearer token before connecting.');
      const result = await request('/api/apps/connectors/' + encodeURIComponent(connector.id) + (connector.connected ? '/reconnect' : '/connect'), {
        method: 'POST', body: JSON.stringify({ profileID, ...(secret?.value.trim() ? { token: secret.value.trim() } : {}), ...(Object.values(environment).some(input => input.value) ? { environment: Object.fromEntries(Object.entries(environment).filter(([, input]) => input.value).map(([key,input]) => [key,input.value])) } : {}) }),
      });
      if (secret) secret.value = '';
      for (const input of Object.values(environment)) input.value = '';
      if (result.kind === 'oauth') {
        const url = new URL(result.authorizationURL);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The connector returned an invalid authorization URL.');
        const link = element('a', 'Continue to sign in to ' + connector.displayName);
        link.href = url.toString(); link.target = '_blank'; link.rel = 'noopener noreferrer';
        field('liveAuthLink').replaceChildren(link);
        message(status, 'Finish sign-in in the new tab, then refresh connections.');
        message(feedback, 'Sign-in is ready.');
      } else {
        message(status, connector.displayName + ' connected for ' + profileID + '.');
        await refresh();
      }
    }, 'primary');
    button('Test tools', async () => {
      const result = await request('/api/apps/connectors/' + encodeURIComponent(connector.id) + '/tools', {
        method: 'POST', body: JSON.stringify({ profileID }),
      });
      const definitions = result.tools || [];
      feedback.replaceChildren(element('span', definitions.length + (definitions.length === 1 ? ' tool discovered.' : ' tools discovered.')));
      const toolList = element('ul', undefined, 'connector-tools');
      for (const tool of definitions) toolList.append(element('li', tool.name + (tool.description ? ' — ' + tool.description : '')));
      feedback.append(toolList);
    }, 'secondary', !connector.connected);
    if (connector.sync) button('Index changes', async () => {
      const result = await request('/api/apps/connectors/' + encodeURIComponent(connector.id) + '/sync', { method: 'POST', body: JSON.stringify({ profileID }) });
      message(feedback, 'Indexed ' + (result.imported ?? result.records ?? 0) + ' changed records.');
    }, 'secondary', !connector.connected);
    button('Disconnect', async () => {
      await request('/api/apps/connectors/' + encodeURIComponent(connector.id) + '/disconnect', {
        method: 'POST', body: JSON.stringify({ profileID }),
      });
      message(status, connector.displayName + ' disconnected for ' + profileID + '.');
      await refresh();
    }, 'secondary', !connector.desiredConnected && !connector.connected && (connector.authentication === 'none' || !connector.authenticated));
    button('Edit', async () => { edit(connector); message(feedback, ''); });
    button('Remove', async () => {
      if (!confirm('Remove ' + connector.displayName + ' and its saved connections from every profile?')) {
        message(feedback, ''); return;
      }
      await request('/api/apps/connectors/' + encodeURIComponent(connector.id), { method: 'DELETE' });
      if (editing?.id === connector.id) resetForm();
      message(status, connector.displayName + ' removed.');
      await refresh();
    }, 'danger');
    row.append(actions, feedback);
    return row;
  }
  function backgroundRefresh() {
    const typingSecret = [...(list.querySelectorAll?.('input') || [])].some(input => input.value);
    if (document.hidden || typingSecret) { scheduleRefresh(); return; }
    return refresh({ quiet: true });
  }
  function scheduleRefresh() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(backgroundRefresh, 15000);
    retryTimer.unref?.();
  }
  window?.addEventListener('focus', backgroundRefresh);
  window?.addEventListener('pagehide', () => clearTimeout(retryTimer));
  async function refresh({ quiet = false } = {}) {
    clearTimeout(retryTimer);
    const currentRevision = ++revision;
    if (!quiet) {
      list.replaceChildren();
      nativeList.replaceChildren();
      message(notice, 'Loading connections…');
    }
    try {
      const profileID = selectedProfile();
      const value = await request('/api/apps/state?profileID=' + encodeURIComponent(profileID));
      if (currentRevision !== revision) return;
      enabled = value.liveConnectorsEnabled !== false;
      field('liveFields').disabled = !enabled;
      list.replaceChildren();
      nativeList.replaceChildren();
      message(notice, enabled ? 'Connections for ' + (profile.selectedOptions?.[0]?.textContent || profileID) : 'Enable the Live connectors mod in Dia Mods and restart Dia+ to use live connections.');
      const connectors = value.connectors || [];
      if (connectors.some(connector => connector.desiredConnected && !connector.executionReady && connector.connectionState !== 'auth-required')) scheduleRefresh();
      const custom = enabled ? connectors.filter(item => item.execution === 'bridge') : [];
      savedIDs = new Set(custom.map(item => item.id));
      if (enabled && !custom.length) list.append(element('div', 'No live connectors added yet. Choose a connector type below to get started.', 'muted connector-meta'));
      for (const connector of custom) list.append(renderConnector(connector, profileID));
      for (const connector of connectors.filter(item => item.execution !== 'bridge')) nativeList.append(renderConnector(connector, profileID));
      if (!nativeList.children.length) nativeList.append(element('div', 'No browser session connectors reported.', 'muted'));
    } catch (error) {
      if (currentRevision === revision) { message(notice, error.message, true); if (quiet) scheduleRefresh(); }
    }
  }
  field('liveType').addEventListener('change', () => {
    if (field('liveType').value === 'spark-cli') {
      field('liveID').value = 'spark';
      field('liveName').value = 'Spark Mail';
    } else if (field('liveID').value === 'spark') {
      field('liveID').value = ''; field('liveName').value = '';
    }
    updateFields();
  });
  field('liveAuthentication').addEventListener('change', updateFields);
  field('liveManifest').addEventListener('input', updateFields);
  field('cancelLiveEdit').addEventListener('click', () => { resetForm(); message(formStatus, ''); });
  field('refreshLive').addEventListener('click', refresh);
  profile.addEventListener('change', () => { field('liveAuthLink').replaceChildren(); message(status, ''); return refresh(); });
  field('liveHosts').addEventListener('input', () => { hostsEdited = Boolean(field('liveHosts').value.trim()); });
  function inferEndpointHost() {
    if (hostsEdited) return;
    try { field('liveHosts').value = new URL(field('liveEndpoint').value).hostname; } catch { /* Native URL validation explains the error on submit. */ }
  }
  field('liveEndpoint').addEventListener('input', inferEndpointHost);
  field('liveEndpoint').addEventListener('change', inferEndpointHost);
  // Autofill and some browser integrations may set the URL without firing a
  // change event. Populate the required host before native form validation runs.
  field('saveLive').addEventListener('click', inferEndpointHost);
  const callback = new URL('/api/apps/oauth/callback', globalThis.location?.origin || 'http://127.0.0.1:8765');
  callback.hostname = '127.0.0.1';
  field('liveCallback').textContent = callback.toString();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!enabled || !form.reportValidity()) return;
    field('saveLive').disabled = true;
    message(formStatus, 'Saving connector…');
    try {
      const profileID = selectedProfile();
      const spark = field('liveType').value === 'spark-cli';
      const local = ['stdio','cli'].includes(field('liveType').value);
      const advanced = field('liveManifest').value.trim();
      if (!advanced && !editing && savedIDs.has(field('liveID').value.trim())) throw new Error('A connector with this ID already exists. Choose Edit on its card to update it.');
      const manifest = advanced ? JSON.parse(advanced) : {
        id: field('liveID').value.trim(), displayName: field('liveName').value.trim(), execution: 'bridge',
        transport: field('liveType').value === 'mcp' ? 'streamable-http' : field('liveType').value, authentication: spark || local ? 'none' : field('liveAuthentication').value,
        ...(spark ? { command: field('liveCommand').value.trim() } : local ? { command: field('processCommand').value.trim(), args: JSON.parse(field('processArgs').value || '[]'), envKeys: field('processEnv').value.split(/[\s,]+/).filter(Boolean), ...(field('processCwd').value.trim() ? { cwd: field('processCwd').value.trim() } : {}) } : {
          endpoint: field('liveEndpoint').value.trim(),
          allowedDomains: field('liveHosts').value.split(/[\s,]+/).filter(Boolean),
        }),
        ...(editing?.icon ? { icon: editing.icon } : {}),
      };
      if (!advanced && manifest.authentication === 'oauth') manifest.oauth = {
        ...(field('liveAuthorizationURL').value.trim() ? { authorizationURL: field('liveAuthorizationURL').value.trim() } : {}), ...(field('liveTokenURL').value.trim() ? { tokenURL: field('liveTokenURL').value.trim() } : {}),
        ...(field('liveClientID').value.trim() ? { clientID: field('liveClientID').value.trim() } : {}), scopes: field('liveScopes').value.split(/[\s,]+/).filter(Boolean),
        revocationURL: field('liveRevocationURL').value.trim() || null,
      };
      if (!editing && savedIDs.has(manifest.id)) throw new Error('A connector with this ID already exists. Choose Edit to update it.');
      if (editing && manifest.id !== editing.id) throw new Error('The connector ID cannot change while editing.');
      await request('/api/apps/connectors', { method: 'POST', body: JSON.stringify({ profileID, manifest }) });
      resetForm();
      message(formStatus, manifest.displayName + ' saved. Choose Connect above to enable it for ' + profileID + '.');
      await refresh();
    } catch (error) {
      message(formStatus, error.message, true);
    } finally {
      field('saveLive').disabled = false;
    }
  });
  updateFields();
  const ready = refresh();
  return { ready, refresh };
}

export function renderModsPage(adminToken) {
  const token = JSON.stringify(adminToken).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dia Mods</title>
  <style>
    :root { color-scheme: light dark; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 54px 26px 36px; background: Canvas; color: CanvasText; }
    body::before { content: ''; position: fixed; z-index: 100; inset: 0 0 auto 0; height: 45px; background: Canvas; }
    h1 { display: none; }
    .intro, #notice, .description, .meta { color: color-mix(in srgb, CanvasText 58%, transparent); line-height: 1.4; }
    #notice { margin: 16px 0 8px; }
    .list { border-radius: 10px; background: color-mix(in srgb, Canvas 94%, CanvasText 6%); padding: 0 12px; }
    .mod { display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center; min-height: 67px; padding: 11px 2px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
    .mod:last-child { border-bottom: 0; }
    .title { font-weight: 600; margin-bottom: 2px; }
    .meta { font-size: 11px; margin-top: 3px; }
    input { width: 36px; height: 21px; accent-color: #0a84ff; }
    input:disabled { opacity: .55; }
    #status { min-height: 18px; margin-top: 10px; }
    .error { color: #e5484d; }
  </style>
</head>
<body>
  <h1>Dia Mods</h1>
  <div class="intro">Configure the independent changes that make Dia+ work. Required isolation and routing protections stay locked on.</div>
  <div id="notice"></div>
  <div id="list" class="list"></div>
  <div id="status" class="intro"></div>
  <script>
    const token = ${token};
    const list = document.querySelector('#list');
    const notice = document.querySelector('#notice');
    const status = document.querySelector('#status');
    async function request(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'content-type': 'application/json', 'x-dia-custom-token': token, ...(options.headers || {}) },
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || ('HTTP ' + response.status));
      return value;
    }
    async function load() {
      const value = await request('/api/mods');
      notice.textContent = value.rebuildRequired
        ? 'Rebuild Dia+ to apply pending build changes.'
        : value.restartRequired
          ? 'Restart Dia+ to apply pending changes.'
          : value.unavailableMods.length
            ? value.unavailableMods.length + ' configured mod(s) are temporarily unavailable for this Dia build.'
            : 'All configured mods are active.';
      list.replaceChildren();
      for (const mod of value.mods) {
        const row = document.createElement('div'); row.className = 'mod';
        const copy = document.createElement('div');
        const title = document.createElement('div'); title.className = 'title'; title.textContent = mod.label;
        const description = document.createElement('div'); description.className = 'description'; description.textContent = mod.description;
        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = mod.unavailable ? 'Temporarily unavailable · ' + mod.compatibilityReason :
          mod.required ? 'Required safety/core mod' :
          (mod.rebuildOnChange ? 'Rebuild after changes' : 'Restart after changes') +
          (mod.requiresStableSignature ? ' · stable signing required' : '') +
          (mod.pending ? ' · change pending' : '');
        copy.append(title, description, meta);
        if (mod.privacyNotice) {
          const privacy = document.createElement('div'); privacy.className = 'description';
          privacy.textContent = 'Privacy: ' + mod.privacyNotice;
          copy.append(privacy);
        }
        const toggle = document.createElement('input');
        toggle.type = 'checkbox'; toggle.role = 'switch';
        toggle.checked = mod.configuredEnabled; toggle.disabled = mod.required || mod.unavailable;
        toggle.setAttribute('aria-label', 'Enable ' + mod.label);
        toggle.addEventListener('change', async () => {
          const enabled = toggle.checked; toggle.disabled = true;
          status.className = 'intro'; status.textContent = 'Saving ' + mod.label + '…';
          try {
            await request('/api/mods/' + encodeURIComponent(mod.id), {
              method: 'PUT', body: JSON.stringify({ enabled }),
            });
            status.textContent = mod.rebuildOnChange
              ? 'Saved. Rebuild Dia+ to apply it.'
              : 'Saved. Restart Dia+ to apply it.';
            await load();
          } catch (error) {
            toggle.checked = !enabled; toggle.disabled = mod.required;
            status.className = 'error'; status.textContent = error.message;
          }
        });
        row.append(copy, toggle); list.append(row);
      }
    }
    load().catch(error => { status.className = 'error'; status.textContent = error.message; });
  </script>
</body>
</html>`;
}

export function initializeUpdaterSettings({ document, request, confirmInstall = message => globalThis.confirm(message) }) {
  const field = id => document.querySelector('#' + id);
  let timer;
  const bytes = value => {
    if (!Number.isFinite(value) || value < 0) return '';
    const units = ['B','KB','MB','GB']; let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return value.toFixed(unit ? 1 : 0) + ' ' + units[unit];
  };
  let authTimer;
  function renderGitHub(github, busy = false) {
    const allowed = github?.access === 'authorized';
    const problem = { denied: 'This account cannot read DiaMods/DiaPlus. Ask the owner for read access or authorize the organization’s required policy.', 'sign-in-required': 'GitHub authorization is missing, expired or revoked. Sign in to use the updater.', 'rate-limited': 'GitHub rate limit reached. Try again later.', network: 'GitHub could not be reached. Try again later.' }[github?.access];
    field('githubUpdateStatus').textContent = github?.error || (!github?.configured ? 'GitHub App setup is required before the private updater can be used.' : allowed ? 'GitHub access verified' + (github.login ? ' for ' + github.login : '') + ': DiaMods/DiaPlus.' : github?.pending ? 'Authorize this sign-in on GitHub using the code below.' : problem || (github.signedIn ? 'Signed in; repository access must be verified.' : 'Sign in with GitHub to check private mod releases. Manual installers do not require sign-in.'));
    field('githubUpdateSignIn').disabled = busy || !github?.configured || Boolean(github?.pending);
    field('githubUpdateSignOut').hidden = !github?.signedIn;
    field('githubUpdateSignOut').disabled = busy;
    field('githubUpdateCancel').hidden = !github?.pending;
    field('githubUpdateChallenge').hidden = !github?.pending;
    field('githubUpdateCode').textContent = github?.pending ? github.userCode : '';
    clearTimeout(authTimer);
    if (github?.pending) authTimer = setTimeout(pollGitHub, Math.max(5, github.interval || 5) * 1000);
  }
  async function pollGitHub() {
    try { const github = await request('/api/updater/github/poll', { method: 'POST', body: '{}' }); renderGitHub(github); if (!github.pending) await refresh(); }
    catch (error) { field('githubUpdateStatus').textContent = error.message; field('githubUpdateSignIn').disabled = false; }
  }
  async function refresh() {
    try {
      const state = await request('/api/updater');
      const busy = ['checking','downloading','verifying','validating','building','installing','closing','snapshotting','preflight','replacing','restarting'].includes(state.phase);
      renderGitHub(state.github, busy);
      field('updateChannel').value = state.channel ?? 'stable';
      field('updateChannel').disabled = busy || !state.enabled;
      const allowed = state.github?.access === 'authorized';
      const progress = state.phase === 'downloading' ? state.download : null;
      const percent = Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
      const phase = ({ 'compatibility-review': 'waiting for confirmation', snapshotting: 'backing up profile',
        preflight: 'checking profile', replacing: 'installing update', restarting: 'reopening Dia+' })[state.phase] ?? state.phase;
      const showCompatibility = Array.isArray(state.compatibility?.perMod) &&
        ['validating','building','compatibility-review','ready','installing','closing','snapshotting','preflight','replacing','restarting','installed','failed','recovery-required'].includes(state.phase);
      field('updaterStatus').textContent = !state.supported ? 'Available after rebuilding the installed app.' : !state.enabled ? 'Custom updater is disabled.' : 'Build ' + state.currentBuild + ' · ' + phase + (percent === null ? '' : ' · ' + percent + '%');
      field('updaterDetail').textContent = [state.diaRelease || state.release ? 'Latest Dia release: ' + (state.diaRelease || state.release).version + ' (' + (state.diaRelease || state.release).build + ')' : '', state.currentModVersion ? 'Installed mods: ' + state.currentModVersion + '.' : '', state.bundle ? 'Available mods: ' + state.bundle.manifest.version + '.' : '', state.error || '', state.rollbackError || '', showCompatibility ? state.compatibility.perMod.filter(m => m.compatible).length + ' mods passed compatibility checks.' : '', state.modRepository || ''].filter(Boolean).join(' ');
      field('updaterProgress').hidden = !progress;
      if (progress) {
        field('updaterProgressBar').value = percent ?? 0;
        const elapsed = (Date.now() - Date.parse(progress.startedAt)) / 1000;
        const rate = elapsed > 0 ? progress.receivedBytes / elapsed : 0;
        const remaining = rate > 0 ? Math.ceil((progress.totalBytes - progress.receivedBytes) / rate) : null;
        field('updaterProgressText').textContent = bytes(progress.receivedBytes) + ' of ' + bytes(progress.totalBytes) +
          (rate > 0 ? ' · ' + bytes(rate) + '/s' : '') +
          (remaining !== null && remaining > 0 ? ' · about ' + (remaining < 60 ? remaining + ' sec' : Math.ceil(remaining / 60) + ' min') + ' remaining' : '');
      }
      const failures = showCompatibility ? state.compatibility.perMod.filter(mod => !mod.compatible) : [];
      const requiredFailures = failures.filter(mod => mod.required || mod.criticality === 'critical');
      const review = field('updaterCompatibility');
      review.hidden = failures.length === 0;
      if (failures.length) {
        const heading = requiredFailures.length ? 'Update cannot continue because required mods are incompatible:' :
          state.phase === 'compatibility-review' ? 'Continue updating? These incompatible mods will be disabled:' : 'Incompatible mods disabled for this Dia build:';
        review.textContent = heading + '\n' + failures.map(mod => '• ' + (mod.label || mod.id) + ' — ' + (mod.reason || 'Compatibility check failed')).join('\n') +
          (!requiredFailures.length && state.phase === 'compatibility-review' ? '\n\nThey will be re-enabled automatically when a later compatible update is installed.' : '');
      }
      field('checkUpdate').disabled = busy || !state.supported || !state.enabled;
      field('prepareUpdate').disabled = busy || !state.supported || !state.enabled || !allowed || !['available','failed'].includes(state.phase) || !state.options?.some(option => option.kind === 'mods');
      field('prepareDiaUpdate').disabled = busy || !state.supported || !state.enabled || !allowed || !['available','failed'].includes(state.phase) || !state.options?.some(option => option.kind === 'dia-and-mods');
      field('continueUpdate').hidden = state.phase !== 'compatibility-review' || requiredFailures.length > 0;
      field('continueUpdate').disabled = state.phase !== 'compatibility-review' || requiredFailures.length > 0 || !allowed;
      field('installUpdate').disabled = state.phase !== 'ready' || !state.enabled || !allowed;
      clearTimeout(timer); if (busy) timer = setTimeout(refresh, 2000);
    } catch (error) { field('updaterStatus').textContent = error.message; }
  }
  for (const [id, action, kind] of [['checkUpdate','check'],['prepareUpdate','prepare','mods'],['prepareDiaUpdate','prepare','dia-and-mods'],['installUpdate','install']]) {
    field(id).addEventListener('click', async () => {
      if (action === 'install' && !confirmInstall('Install this verified update and restart Dia+? Your profile and provider choices will be retained. Cancelling the browser’s quit will cancel installation.')) return;
      field(id).disabled = true;
      field('updaterStatus').textContent = action === 'install' ? 'Restarting Dia+. This page will close during installation.' : 'Working…';
      try { await request('/api/updater/' + action, { method: 'POST', body: JSON.stringify(kind ? { kind } : {}) }); await refresh(); }
      catch (error) { field('updaterStatus').textContent = error.message; field(id).disabled = false; }
    });
  }
  for (const [id, action] of [['githubUpdateSignIn','start'], ['githubUpdateSignOut','sign-out'], ['githubUpdateCancel','cancel']]) {
    field(id).addEventListener('click', async () => {
      clearTimeout(authTimer);
      try { const github = await request('/api/updater/github/' + action, { method: 'POST', body: '{}' }); renderGitHub(github); if (!github.pending) await refresh(); }
      catch (error) { field('githubUpdateStatus').textContent = error.message; }
    });
  }
  field('updateChannel').addEventListener('change', async () => {
    try { await request('/api/updater/channel', { method: 'POST', body: JSON.stringify({ channel: field('updateChannel').value }) }); await refresh(); }
    catch (error) { field('updaterStatus').textContent = error.message; }
  });
  field('continueUpdate').addEventListener('click', async () => {
    field('continueUpdate').disabled = true;
    field('updaterStatus').textContent = 'Disabling incompatible mods and continuing…';
    try { await request('/api/updater/continue', { method: 'POST', body: '{}' }); await refresh(); }
    catch (error) { field('updaterStatus').textContent = error.message; field('continueUpdate').disabled = false; }
  });
  return { ready: refresh(), refresh };
}

export function initializeWorkflowSettings({ document, request }) {
  const field = id => document.querySelector('#' + id);
  const status = text => { field('workflowStatus').textContent = text; };
  const profileID = () => field('workflowProfile').value.trim();
  const query = () => '?profileID=' + encodeURIComponent(profileID());
  let revision = 0, timer;
  const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
  function button(parent, title, action) {
    const node = element('button', title); node.type = 'button'; node.className = 'secondary';
    node.addEventListener('click', async () => { node.disabled = true; try { await action(); await refresh(); } catch(error) { status(error.message); } finally { node.disabled = false; } });
    parent.append(node);
  }
  async function refresh() {
    const current = ++revision;
    try {
      const [knowledge, schedules, runs] = await Promise.all([request('/api/knowledge' + query()), request('/api/workflows' + query()), request('/api/workflows/runs' + query())]);
      if (current !== revision) return;
      field('knowledgeList').replaceChildren();
      for (const doc of knowledge.documents || []) {
        const row = element('div', ''); row.className = 'provider';
        row.append(element('strong', doc.title));
        if (doc.url) { const link = element('a', ' Source'); const url = new URL(doc.url); if (['https:','http:'].includes(url.protocol)) { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); } }
        const details = element('details', ''); const content = element('pre', doc.content || ''); details.append(element('summary', 'Read document'), content);
        details.addEventListener('toggle', async () => { if (!details.open || !doc.truncated) return; try { const full = await request('/api/knowledge/' + encodeURIComponent(doc.id) + query()); content.textContent = full.documents?.[0]?.content || full.document?.content || ''; doc.truncated = false; } catch(error) { status(error.message); } });
        details.style.whiteSpace = 'pre-wrap'; details.style.overflowWrap = 'anywhere'; row.append(details);
        button(row, 'Remove', () => request('/api/knowledge/' + encodeURIComponent(doc.id) + query(), { method: 'DELETE' }));
        field('knowledgeList').append(row);
      }
      if (!(knowledge.documents || []).length) field('knowledgeList').textContent = 'No documents in this profile yet.';
      field('workflowList').replaceChildren();
      for (const workflow of schedules.workflows || []) {
        const row = element('div', ''); row.className = 'provider';
        row.append(element('strong', workflow.title), element('div', (workflow.enabled ? 'Enabled' : 'Disabled') + ' · Every ' + workflow.intervalMinutes + ' minutes' + (workflow.lastError ? ' · ' + workflow.lastError : '')));
        button(row, 'Run now', () => request('/api/workflows/' + encodeURIComponent(workflow.id) + '/run', { method: 'POST', body: JSON.stringify({ profileID: profileID() }) }));
        button(row, workflow.enabled ? 'Disable' : 'Enable', () => request('/api/workflows', { method: 'POST', body: JSON.stringify({ ...workflow, profileID: profileID(), enabled: !workflow.enabled }) }));
        button(row, 'Remove', () => request('/api/workflows/' + encodeURIComponent(workflow.id) + query(), { method: 'DELETE' }));
        field('workflowList').append(row);
      }
      field('researchRuns').replaceChildren();
      for (const job of (runs.runs || []).slice(0, 10)) field('researchRuns').append(element('div', job.title + ' · ' + job.status + (job.error ? ' · ' + job.error : '')));
      clearTimeout(timer); if ((runs.runs || []).some(job => job.status === 'running')) timer = setTimeout(refresh, 2000);
    } catch (error) { status(error.message); }
  }
  field('refreshWorkflows').addEventListener('click', refresh);
  field('workflowProfile').addEventListener('change', refresh);
  field('knowledgeForm').addEventListener('submit', async event => {
    event.preventDefault(); status('Importing document…');
    try {
      const file = field('knowledgeFile').files[0];
      if (file && file.size > 4 * 1024 * 1024) throw new Error('Choose a text file smaller than 4 MB.');
      await request('/api/knowledge', { method: 'POST', body: JSON.stringify({ profileID: profileID(), title: field('knowledgeTitle').value, content: file ? await file.text() : field('knowledgeContent').value || undefined, url: field('knowledgeURL').value || undefined, fileName: file?.name }) });
      status('Document imported.'); await refresh();
    } catch (error) { status(error.message); }
  });
  const payload = () => ({ profileID: profileID(), title: field('researchTitle').value, prompt: field('researchPrompt').value, intervalMinutes: Number(field('workflowInterval').value), enabled: field('workflowEnabled').checked });
  field('researchForm').addEventListener('submit', async event => {
    event.preventDefault(); status('Starting research…');
    try { await request('/api/research', { method: 'POST', body: JSON.stringify(payload()) }); status('Research is running. The result will appear in this profile’s knowledge base.'); await refresh(); }
    catch (error) { status(error.message); }
  });
  field('saveWorkflow').addEventListener('click', async () => {
    if (!field('researchForm').reportValidity()) return;
    try { await request('/api/workflows', { method: 'POST', body: JSON.stringify(payload()) }); status('Automation saved.'); await refresh(); }
    catch (error) { status(error.message); }
  });
  return { ready: refresh(), refresh };
}

export function initializeMediaSettings({ document, request }) {
  const status = document.querySelector('#speechStatus');
  const button = document.querySelector('#prepareSpeech');
  async function refresh() {
    try {
      const value = await request('/api/media');
      const speech = value.media?.speech;
      status.textContent = speech?.available ? 'Local speech is ready' + (speech.locale ? ' (' + speech.locale + ')' : '') + '.' : speech?.reason || ('Speech assets: ' + (speech?.state || 'unavailable'));
      button.disabled = speech?.available === true;
    } catch(error) { status.textContent = error.message; }
  }
  button.addEventListener('click', async () => {
    button.disabled = true; status.textContent = 'Preparing Apple’s local speech files…';
    try { await request('/api/media/prepare-speech', { method: 'POST', body: '{}' }); await refresh(); }
    catch(error) { status.textContent = error.message; button.disabled = false; }
  });
  return { ready: refresh(), refresh };
}
