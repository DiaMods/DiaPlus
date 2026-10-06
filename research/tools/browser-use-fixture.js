#!/usr/bin/env node
// Credential-free, loopback-only provider and page fixture for disposable native QA.
import { createServer } from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = resolve(process.argv[2]);
const test = JSON.parse(await readFile(join(root, 'test.json'), 'utf8'));
if (test.root !== root || !root.includes('/dia-browser-use-research-')) throw new Error('Expected a prepared disposable research directory.');
let clicks = 0;
const page = '<!doctype html><html><title>Dia Browser Use QA</title><h1>Isolated browser test</h1><p id="result">Counter: 0</p><button onclick="fetch(\'/click\', {method:\'POST\'}).then(r=>r.json()).then(r=>document.getElementById(\'result\').textContent=\'Counter: \'+r.clicks)">Increment test counter</button><p>No accounts, cookies, or external requests.</p></html>';
const server = createServer(async (req, res) => {
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.url === '/qa') { res.setHeader('content-type', 'text/html'); return res.end(page); }
  if (req.url === '/click' && req.method === 'POST') return json({ clicks: ++clicks });
  if (req.url === '/state') return json({ clicks });
  if (req.url === '/v1/models') return json({ data: [{ id: 'qa' }] });
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.statusCode = 404; return res.end(); }
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const names = (payload.tools ?? []).map(tool => tool.function?.name);
    const last = payload.messages?.at(-1);
    await appendFile(join(root, 'fixture-requests.jsonl'), JSON.stringify({ names, messageCount: payload.messages?.length,
      lastRole: last?.role, tool_choice: payload.tool_choice,
      // Never record arbitrary native context (including clipboard suggestions).
      nativeResult: last?.role === 'tool' ? String(last.content).slice(0, 12_000) : undefined,
    }) + '\n', { mode: 0o600 });
    let message = { role: 'assistant', content: 'Local QA fixture is connected.' };
    let finish = 'stop';
    if (last?.role === 'tool') message.content = 'Native tool result: ' + last.content;
    else {
      const text = String(last?.content ?? '');
      const browser = names.find(name => /(?:^|__)browser_use$/.test(name));
      const search = names.find(name => name === 'ToolSearch');
      if (/QA browser/i.test(text)) {
        let fn, args;
        if (browser) { fn = browser; args = { code: 'output(await browser.pages.list());' }; }
        else if (search) { fn = search; args = { query: 'select:mcp__dia-tools__browser_use' }; }
        else message.content = 'Browser Use is not exposed in the native request. Available tools: ' + names.join(', ');
        if (fn) { message = { role: 'assistant', content: null, tool_calls: [{ id: 'qa-browser-read', type: 'function', function: { name: fn, arguments: JSON.stringify(args) } }] }; finish = 'tool_calls'; }
      }
    }
    res.setHeader('content-type', 'text/event-stream');
    const delta = message.tool_calls
      ? { role: 'assistant', tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) }
      : { role: 'assistant', content: message.content };
    res.write('data: ' + JSON.stringify({ id: 'qa-completion', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'qa-completion', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n');
    return res.end('data: [DONE]\n\n');
  } catch (error) { res.statusCode = 500; return json({ error: String(error) }); }
});
server.listen(test.fixturePort, '127.0.0.1', () => console.log('Local QA fixture ready on ' + test.fixturePort));
process.on('SIGTERM', () => server.close());
