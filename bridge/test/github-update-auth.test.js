import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubUpdateAuth, GitHubKeychain } from '../src/github-update-auth.js';
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const tokens = { access_token: 'SECRET-ACCESS', refresh_token: 'SECRET-REFRESH', expires_in: 28800, refresh_token_expires_in: 15897600 };
function fixture(handler) {
  let saved = null, now = 100000;
  const requests = [];
  const store = { get: async () => structuredClone(saved), set: async value => { saved = structuredClone(value); }, delete: async () => { saved = null; } };
  const auth = new GitHubUpdateAuth({ clientID: 'Iv1.test-client', store, now: () => now, fetchImpl: async (url, options) => { requests.push({ url, options }); return handler(url, options); } });
  return { auth, requests, store, advance: milliseconds => { now += milliseconds; }, saved: () => saved };
}
function api(url) {
  if (url.endsWith('/user')) return response({ login: 'read-only-friend' });
  return response({ full_name: 'DiaMods/DiaPlus', private: true, permissions: { pull: true, push: false } });
}
async function login(f) { await f.auth.saveTokens(tokens); }
test('device sign-in uses the user token, read-only access, public challenge and Keychain only', async () => {
  const f = fixture(url => url.endsWith('/device/code') ? response({ device_code: 'SECRET-DEVICE', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }) : url.endsWith('/oauth/access_token') ? response(tokens) : api(url));
  const challenge = await f.auth.start();
  assert.equal(challenge.userCode, 'ABCD-EFGH'); assert.doesNotMatch(JSON.stringify(challenge), /SECRET/);
  const status = await f.auth.poll();
  assert.equal(status.access, 'authorized'); assert.equal(status.login, 'read-only-friend');
  assert.doesNotMatch(JSON.stringify(status), /SECRET/); assert.equal(f.saved().accessToken, tokens.access_token);
  for (const { url, options } of f.requests) {
    if (url.startsWith('https://api.github.com/')) { assert.equal(options.headers.authorization, 'Bearer SECRET-ACCESS'); assert.equal(options.headers['x-github-api-version'], '2026-03-10'); }
    else { assert(!options.headers.authorization); assert(!options.body.includes('client_secret')); assert(!options.body.includes('scope=')); }
  }
  await f.auth.signOut(); assert.equal(f.saved(), null); assert.equal((await f.auth.status()).signedIn, false);
});
test('device flow respects polling intervals, slow_down, cancellation and expiry', async () => {
  let polls = 0;
  const f = fixture(url => url.endsWith('/device/code') ? response({ device_code: 'secret', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 30, interval: 5 }) : response(++polls === 1 ? { error: 'slow_down' } : { error: 'authorization_pending' }));
  await f.auth.start(); assert.equal((await f.auth.poll()).interval, 10);
  await f.auth.poll(); assert.equal(polls, 1);
  f.advance(10000); await f.auth.poll(); assert.equal(polls, 2);
  f.advance(30000); await assert.rejects(f.auth.poll(), { code: 'expired' });
  await f.auth.start(); f.auth.cancel(); assert.equal((await f.auth.poll()).pending, false); assert.equal(f.saved(), null);
});
test('cancelled in-flight authorization never persists a token', async () => {
  let release;
  const f = fixture(url => url.endsWith('/device/code') ? response({ device_code: 'secret', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 900 }) : new Promise(resolve => { release = resolve; }));
  await f.auth.start(); const pending = f.auth.poll(); await new Promise(resolve => setImmediate(resolve));
  f.auth.cancel(); release(response(tokens)); await pending; assert.equal(f.saved(), null);
});
test('concurrent refresh rotates once without an app secret, and sign-out cannot restore credentials', async () => {
  let release, refreshes = 0;
  const f = fixture((url, options) => { assert(url.endsWith('/oauth/access_token')); assert(!options.body.includes('client_secret')); assert(new URLSearchParams(options.body).get('refresh_token') === tokens.refresh_token); refreshes++; return new Promise(resolve => { release = resolve; }); });
  await login(f); f.advance(28800000);
  const first = f.auth.token(), second = f.auth.token(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1); const signOut = f.auth.signOut(); release(response({ ...tokens, access_token: 'ROTATED' }));
  await Promise.allSettled([first, second]); await signOut; assert.equal(f.saved(), null);
});
test('expired tokens refresh automatically and API 401 refreshes once', async () => {
  let refreshed = false;
  const f = fixture(url => url.endsWith('/oauth/access_token') ? (refreshed = true, response({ ...tokens, access_token: 'ROTATED' })) : !refreshed ? response({}, 401) : api(url));
  await login(f); const status = await f.auth.verifyAccess(); assert.equal(status.access, 'authorized'); assert.equal(f.saved().accessToken, 'ROTATED');
  assert.equal(f.requests.filter(r => r.url.endsWith('/oauth/access_token')).length, 1);
});
for (const [name, status, headers, code] of [
  ['nonmember or revoked read access', 404, {}, 'access-denied'],
  ['organization authorization restriction', 403, { 'x-github-sso': 'required' }, 'access-denied'],
  ['primary rate limit', 403, { 'x-ratelimit-remaining': '0' }, 'rate-limited'],
  ['secondary rate limit', 429, { 'retry-after': '60' }, 'rate-limited'],
  ['server failure', 502, {}, 'network'],
]) test(name + ' leaves credentials private and does not affect the installed browser', async () => {
  const f = fixture(() => response({ message: 'SECRET-SERVER-DATA' }, status, headers)); await login(f);
  await assert.rejects(f.auth.verifyAccess(), error => error.code === code && !error.message.includes('SECRET'));
  assert.doesNotMatch(JSON.stringify(await f.auth.status()), /SECRET/); assert(f.saved());
});
test('revoked refresh and missing/expired authorization are distinct from network errors', async () => {
  const f = fixture(() => response({ error: 'bad_refresh_token', error_description: 'SECRET' }));
  await assert.rejects(f.auth.verifyAccess(), { code: 'sign-in-required' });
  await login(f); f.advance(28800000); await assert.rejects(f.auth.verifyAccess(), { code: 'sign-in-required' });
  assert.equal((await f.auth.status()).access, 'sign-in-required');
  const offline = fixture(() => { throw new Error('SECRET header body'); }); await login(offline); await assert.rejects(offline.auth.verifyAccess(), error => error.code === 'network' && !error.message.includes('SECRET'));
});
test('Keychain failure is fail-closed, with no plaintext fallback or token return', async () => {
  const f = fixture(api); f.auth.store = { get: async () => { throw new Error('Keychain unavailable'); } };
  await assert.rejects(f.auth.verifyAccess(), /Keychain/);
  await assert.rejects(new GitHubKeychain(null).get(), { code: 'keychain' });
  await assert.rejects(new GitHubKeychain('/nonexistent/dia-plus-keychain').set({ accessToken: 'SECRET' }), error => error.code === 'keychain' && !error.message.includes('SECRET'));
});
test('authorization cannot be sent to an unrelated API or redirected by an API request', async () => {
  const f = fixture((url, options) => { assert.equal(options.redirect, 'error'); throw Error('redirect'); }); await login(f);
  for (const path of ['/repos/other/repo', '//evil.test', '/repos/DiaMods/DiaPlus/../other', '/user?next=evil']) await assert.rejects(f.auth.api(path), { code: 'destination' });
  await assert.rejects(f.auth.api('/repos/DiaMods/DiaPlus'), { code: 'network' });
});
