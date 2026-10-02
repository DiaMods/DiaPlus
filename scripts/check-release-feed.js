#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseAppcast, allowedDownload } from '../bridge/src/updater-common.js';
const source = JSON.parse(await readFile(new URL('../src/config/updater-source.json', import.meta.url)));
const pinned = JSON.parse(await readFile(new URL('../src/config/release-build.json', import.meta.url))).dia;
const response = await fetch(allowedDownload(source.feedURL, source), { redirect: 'error', signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Official Dia feed could not be checked; release validation fails closed');
let bytes = 0, text = '';
for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 2 * 1024 ** 2) throw new Error('Official feed exceeds limit'); text += Buffer.from(chunk); }
const latest = parseAppcast(text, source);
if (latest.build !== pinned.build || latest.version !== pinned.version || latest.url !== pinned.url || latest.signature !== pinned.signature || latest.length !== pinned.length) throw new Error(`Official Dia is now ${latest.version} (${latest.build}); audit the new build and update the release pin before releasing mods.`);
console.log(`Official feed matches audited Dia ${pinned.version} (${pinned.build}).`);
