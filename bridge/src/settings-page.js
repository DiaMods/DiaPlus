export function renderSettingsPage(adminToken) {
  const token = JSON.stringify(adminToken).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dia Custom Models</title>
  <style>
    :root { color-scheme: light dark; font: 15px -apple-system, BlinkMacSystemFont, sans-serif; }
    body { max-width: 820px; margin: 48px auto; padding: 0 24px 80px; background: Canvas; color: CanvasText; }
    h1 { font-size: 30px; margin-bottom: 6px; }
    h2 { margin-top: 34px; font-size: 19px; }
    .muted { color: color-mix(in srgb, CanvasText 58%, transparent); line-height: 1.5; }
    .card { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 14px; padding: 18px; margin-top: 16px; background: color-mix(in srgb, Canvas 96%, CanvasText 4%); }
    .row { display: flex; gap: 10px; align-items: center; }
    select, button, textarea { font: inherit; }
    select { flex: 1; min-width: 0; padding: 10px; border-radius: 9px; }
    button { padding: 10px 14px; border: 0; border-radius: 9px; background: #5b5ce2; color: white; cursor: pointer; }
    button.secondary { background: color-mix(in srgb, CanvasText 12%, transparent); color: CanvasText; }
    button:disabled { opacity: .55; cursor: default; }
    textarea { box-sizing: border-box; width: 100%; min-height: 420px; padding: 12px; border-radius: 10px; tab-size: 2; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
    #status { min-height: 22px; margin-top: 10px; }
    .error { color: #e5484d; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; }
  </style>
</head>
<body>
  <h1>Dia Custom Models</h1>
  <div class="muted">Choose the model behind Dia's native chat. The browser still owns context, tabs, reports, and confirmations; this local bridge owns model routing and memory.</div>

  <div class="card">
    <div class="row">
      <select id="models" aria-label="Selected model"></select>
      <button id="select">Use model</button>
      <button id="refresh" class="secondary">Refresh</button>
    </div>
    <div id="status" class="muted"></div>
  </div>

  <h2>Provider configuration</h2>
  <div class="muted">Ollama is discovered at <code>127.0.0.1:11434</code>. Configure OpenAI securely with <code>./dia-custom openai-key</code>; the key stays in this macOS login session and is never written here. Add future OpenAI-compatible providers in this JSON.</div>
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
        const [catalog, config] = await Promise.all([
          request('/api/models' + (force ? '?refresh=1' : '')),
          request('/api/config'),
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
    load();
  </script>
</body>
</html>`;
}
