export function renderSettingsPage(adminToken) {
  const token = JSON.stringify(adminToken).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dia Custom Models & Data</title>
  <style>
    :root { color-scheme: light dark; font: 15px -apple-system, BlinkMacSystemFont, sans-serif; }
    body { max-width: 820px; margin: 48px auto; padding: 0 24px 80px; background: Canvas; color: CanvasText; }
    h1 { font-size: 30px; margin-bottom: 6px; }
    h2 { margin-top: 34px; font-size: 19px; scroll-margin-top: 24px; }
    .muted { color: color-mix(in srgb, CanvasText 58%, transparent); line-height: 1.5; }
    .card { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 14px; padding: 18px; margin-top: 16px; background: color-mix(in srgb, Canvas 96%, CanvasText 4%); }
    .row { display: flex; gap: 10px; align-items: center; }
    select, button, textarea, input { font: inherit; }
    select { flex: 1; min-width: 0; padding: 10px; border-radius: 9px; }
    input { box-sizing: border-box; min-width: 0; padding: 10px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 9px; background: Canvas; color: CanvasText; }
    button { padding: 10px 14px; border: 0; border-radius: 9px; background: #5b5ce2; color: white; cursor: pointer; }
    button.secondary { background: color-mix(in srgb, CanvasText 12%, transparent); color: CanvasText; }
    button:disabled { opacity: .55; cursor: default; }
    .memory-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .stat { padding: 12px; border-radius: 9px; background: color-mix(in srgb, CanvasText 6%, transparent); }
    .stat strong { display: block; font-size: 20px; margin-bottom: 3px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .provider { padding: 14px 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
    .provider:last-child { border-bottom: 0; }
    .mod { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; padding: 14px 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
    .mod:last-child { border-bottom: 0; }
    .mod-title { font-weight: 600; margin-bottom: 4px; }
    .mod-meta { font-size: 12px; margin-top: 5px; }
    .mod input[type="checkbox"] { width: 38px; height: 22px; accent-color: #5b5ce2; }
    .provider-title { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
    .provider .row { margin-top: 8px; }
    .provider input { flex: 1; }
    .add-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    .add-grid .wide { grid-column: 1 / -1; }
    button.danger { background: #b4232c; }
    textarea { box-sizing: border-box; width: 100%; min-height: 420px; padding: 12px; border-radius: 10px; tab-size: 2; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
    #status { min-height: 22px; margin-top: 10px; }
    .error { color: #e5484d; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; }
  </style>
</head>
<body>
  <h1>Dia Custom Models</h1>
  <div class="muted">Choose the model behind Dia's native chat. The browser still owns context, tabs, reports, and native tool surfaces; this local bridge owns model routing and memory.</div>

  <div class="card">
    <div class="row">
      <select id="models" aria-label="Selected model"></select>
      <button id="select">Use model</button>
      <button id="refresh" class="secondary">Refresh</button>
    </div>
    <div id="status" class="muted"></div>
  </div>

  <h2 id="dia-mods">Dia Mods</h2>
  <div class="muted">Each browser change is an independent Dia Mod. Optional mods can be configured here; isolation, update, and local-routing protections stay locked on.</div>
  <div class="card">
    <div id="modNotice" class="muted"></div>
    <div id="modList"></div>
    <div id="modStatus" class="muted" style="margin-top:10px"></div>
  </div>

  <h2 id="local-memory">Local memory</h2>
  <div class="muted">Browsing, chat evidence, and derived Memories stay in an owner-only SQLite database on this Mac. The selected model derives durable context; semantic matching uses Apple's on-device sentence embeddings when available. Nothing is sent to Dia.</div>
  <div class="card">
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

  <h2 id="provider-configuration">Provider configuration</h2>
  <div class="muted">Keys are never returned to this page or put in the provider JSON. They are stored separately in an owner-only local file and are excluded from the Codex subprocess environment.</div>
  <div class="card" id="providerList"></div>

  <h2 id="tool-coverage">Tool coverage</h2>
  <div class="muted">This inventory updates whenever Dia sends a chat request. Native tools return to Dia's browser harness; local tools execute in the localhost bridge.</div>
  <div class="card">
    <div id="toolSummary" class="muted"></div>
    <div id="toolList" style="margin-top:10px"></div>
  </div>

  <h2 id="local-connectors">Local connectors</h2>
  <div class="muted">Import account exports into the private local index. Records are searchable by every model and never pass through Dia. Future OAuth adapters use this same connector store.</div>
  <div class="card">
    <div class="add-grid">
      <input id="connectorID" placeholder="Connector ID (for example contacts)">
      <input id="connectorLabel" placeholder="Display name (for example Contacts)">
      <input id="connectorFile" class="wide" type="file" accept="application/json,.json">
    </div>
    <div class="row" style="margin-top:10px">
      <button id="importConnector">Import JSON</button>
      <span id="connectorStatus" class="muted"></span>
    </div>
    <div id="connectorList" style="margin-top:12px"></div>
    <div class="muted" style="margin-top:10px">JSON may be an array of records or <code>{ records: [...] }</code>. Each record can contain <code>id</code>, <code>title</code>/<code>name</code>, <code>content</code>, <code>url</code>, <code>updatedAt</code>, and <code>kind: "person"</code>.</div>
  </div>

  <h2 id="add-provider">Add OpenAI-compatible provider</h2>
  <div class="card">
    <div class="add-grid">
      <input id="newProviderID" placeholder="Provider ID (for example lm-studio)">
      <input id="newProviderLabel" placeholder="Display name">
      <input id="newProviderURL" class="wide" placeholder="Base URL (for example http://127.0.0.1:1234/v1)">
      <input id="newProviderDiscovery" class="wide" placeholder="Models discovery URL (optional)">
      <select id="newProviderAPI"><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select>
      <input id="newProviderModels" placeholder="Model IDs, comma-separated">
    </div>
    <div class="row" style="margin-top:10px"><button id="addProvider">Add provider</button><span id="providerStatus" class="muted"></span></div>
  </div>

  <h2 id="advanced-json">Advanced JSON</h2>
  <div class="muted">Use this editor for provider aliases, endpoint details, and memory retention. Dia-owned endpoint URLs are always rejected.</div>
  <div class="card">
    <textarea id="config" spellcheck="false" aria-label="Provider configuration"></textarea>
    <div class="row" style="margin-top:10px">
      <button id="save">Save configuration</button>
      <span id="saveStatus" class="muted"></span>
    </div>
  </div>

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
        const [catalog, config, memory, credentials, connectorData, toolData, modData] = await Promise.all([
          request('/api/models' + (force ? '?refresh=1' : '')),
          request('/api/config'),
          request('/api/memory'),
          request('/api/credentials'),
          request('/api/connectors'),
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
          ? 'A clean Dia Custom rebuild is required to apply pending changes.'
          : modData.restartRequired
            ? 'Restart Dia Custom to apply pending changes.'
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
          meta.textContent = mod.required
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
          toggle.disabled = mod.required;
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
                ? 'Saved. Rebuild Dia Custom to apply this change.'
                : 'Saved. Restart Dia Custom to apply this change.';
              await load();
            } catch (error) {
              toggle.checked = !wanted;
              toggle.disabled = mod.required;
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
            await request('/api/connectors/' + encodeURIComponent(connector.id), { method: 'DELETE' });
            await load();
          });
          row.append(details, remove);
          connectorList.append(row);
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
      } catch (error) {
        status.textContent = error.message;
        status.className = 'error';
      }
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
          body: JSON.stringify({ id, label, records, replace: true }),
        });
        connectorStatus.textContent = 'Imported ' + result.imported + ' records.';
        await load();
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
    load();
  </script>
</body>
</html>`;
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
  <div class="intro">Configure the independent changes that make Dia Custom work. Required isolation and routing protections stay locked on.</div>
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
        ? 'Rebuild Dia Custom to apply pending build changes.'
        : value.restartRequired
          ? 'Restart Dia Custom to apply pending changes.'
          : 'All configured mods are active.';
      list.replaceChildren();
      for (const mod of value.mods) {
        const row = document.createElement('div'); row.className = 'mod';
        const copy = document.createElement('div');
        const title = document.createElement('div'); title.className = 'title'; title.textContent = mod.label;
        const description = document.createElement('div'); description.className = 'description'; description.textContent = mod.description;
        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = mod.required ? 'Required safety/core mod' :
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
        toggle.checked = mod.configuredEnabled; toggle.disabled = mod.required;
        toggle.setAttribute('aria-label', 'Enable ' + mod.label);
        toggle.addEventListener('change', async () => {
          const enabled = toggle.checked; toggle.disabled = true;
          status.className = 'intro'; status.textContent = 'Saving ' + mod.label + '…';
          try {
            await request('/api/mods/' + encodeURIComponent(mod.id), {
              method: 'PUT', body: JSON.stringify({ enabled }),
            });
            status.textContent = mod.rebuildOnChange
              ? 'Saved. Rebuild Dia Custom to apply it.'
              : 'Saved. Restart Dia Custom to apply it.';
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
