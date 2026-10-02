import { spawn } from 'node:child_process';

export const updateRepository = 'DiaMods/DiaPlus';
export class GitHubUpdateError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Secrets travel only over pipes to the native helper, never argv/environment.
export class GitHubKeychain {
  constructor(helper) { this.helper = helper; }
  async operation(operation, value) {
    if (!this.helper) throw new GitHubUpdateError('keychain', 'The GitHub Keychain helper is unavailable. Reinstall Dia+.');
    return new Promise((resolve, reject) => {
      const child = spawn(this.helper, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', size = 0;
      const fail = () => reject(new GitHubUpdateError('keychain', 'macOS Keychain could not complete this operation. No plaintext fallback is used.'));
      const timer = setTimeout(() => { child.kill(); fail(); }, 30000);
      child.on('error', fail); child.stdin.on('error', fail);
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 65536) { child.kill(); fail(); } else output += chunk; });
      child.stderr.on('data', () => {});
      child.on('close', code => { clearTimeout(timer); if (code !== 0) return fail(); try { resolve(JSON.parse(output)); } catch { fail(); } });
      child.stdin.end(JSON.stringify({ operation, value }) + '\n');
    });
  }
  get() { return this.operation('get'); }
  set(value) { return this.operation('set', value); }
  delete() { return this.operation('delete'); }
}

export class GitHubUpdateAuth {
  constructor({ clientID, store, fetchImpl = fetch, now = Date.now }) {
    Object.assign(this, { clientID, store, fetchImpl, now });
    this.pending = null; this.generation = 0; this.access = 'unknown'; this.login = null;
  }
  async request(url, options) {
    try { return await this.fetchImpl(url, { ...options, redirect: options?.redirect ?? 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new GitHubUpdateError('network', 'GitHub could not be reached. Your current Dia+ installation is unchanged.'); }
  }
  async json(response, maximum = 65536) {
    let size = 0, body = '';
    for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw new GitHubUpdateError('response', 'GitHub returned an oversized response.'); body += Buffer.from(chunk); }
    try { return JSON.parse(body); } catch { throw new GitHubUpdateError('response', 'GitHub returned an invalid response.'); }
  }
  async oauth(path, parameters) {
    const response = await this.request(`https://github.com/login/${path}`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientID, ...parameters }).toString(),
    });
    if (response.status === 429 || response.status === 403 && response.headers.has('retry-after')) throw new GitHubUpdateError('rate-limited', 'GitHub rate limit reached. Try signing in again later.');
    if (!response.ok) throw new GitHubUpdateError(response.status >= 500 ? 'network' : 'authentication', 'GitHub sign-in could not be completed.');
    return this.json(response);
  }
  async start() {
    if (!this.clientID) throw new GitHubUpdateError('configuration', 'The owner must configure the GitHub App client ID before releasing this installer.');
    this.cancel();
    this.login = null;
    const generation = this.generation;
    const data = await this.oauth('device/code', {});
    if (generation !== this.generation) throw new GitHubUpdateError('cancelled', 'GitHub sign-in was cancelled.');
    if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string' ||
        data.verification_uri !== 'https://github.com/login/device' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new GitHubUpdateError('response', 'GitHub returned an invalid sign-in challenge.');
    }
    this.pending = { code: data.device_code, generation, interval: Math.max(5, data.interval || 5),
      expires: this.now() + Math.min(data.expires_in, 1800) * 1000, next: 0,
      userCode: data.user_code, verificationURL: data.verification_uri };
    return this.challenge();
  }
  challenge() {
    return this.pending ? { configured: Boolean(this.clientID), userCode: this.pending.userCode, verificationURL: this.pending.verificationURL,
      expiresAt: this.pending.expires, interval: this.pending.interval, pending: true } : { configured: Boolean(this.clientID), pending: false };
  }
  cancel() { this.generation++; this.pending = null; }
  async poll() {
    if (this.polling) return this.polling;
    this.polling = this.pollOnce().finally(() => { this.polling = null; });
    return this.polling;
  }
  async pollOnce() {
    const attempt = this.pending;
    if (!attempt) return { pending: false };
    if (attempt.expires <= this.now()) { this.cancel(); throw new GitHubUpdateError('expired', 'The GitHub sign-in code expired. Start sign-in again.'); }
    if (this.now() < attempt.next) return this.challenge();
    attempt.next = this.now() + attempt.interval * 1000;
    const data = await this.oauth('oauth/access_token', { device_code: attempt.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (this.pending !== attempt) return { pending: false };
    if (data.error === 'authorization_pending') return this.challenge();
    if (data.error === 'slow_down') { attempt.interval = Math.max(attempt.interval + 5, data.interval || 0); attempt.next = this.now() + attempt.interval * 1000; return this.challenge(); }
    if (data.error === 'expired_token') { this.cancel(); throw new GitHubUpdateError('expired', 'The GitHub sign-in code expired. Start sign-in again.'); }
    if (data.error) { this.cancel(); throw new GitHubUpdateError('authentication', 'GitHub sign-in was denied or expired. Start sign-in again when ready.'); }
    await this.saveTokens(data);
    this.pending = null;
    return this.verifyAccess();
  }
  async saveTokens(data) {
    if (typeof data.access_token !== 'string' || !data.access_token ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 || typeof data.refresh_token !== 'string' || !data.refresh_token ||
        !Number.isFinite(data.refresh_token_expires_in) || data.refresh_token_expires_in <= 0) {
      throw new GitHubUpdateError('configuration', 'GitHub must issue expiring user tokens with refresh tokens. Check the GitHub App configuration.');
    }
    await this.store.set({ accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: this.now() + data.expires_in * 1000, refreshExpiresAt: this.now() + data.refresh_token_expires_in * 1000 });
  }
  async token(force = false) {
    if (this.refreshing) return this.refreshing;
    const saved = await this.store.get();
    if (this.refreshing) return this.refreshing;
    if (!saved?.accessToken) throw new GitHubUpdateError('sign-in-required', 'Sign in with GitHub on this Updates screen to use the private updater. Manual installation does not require sign-in.');
    if (!force && saved.expiresAt > this.now() + 60000) return saved.accessToken;
    this.refreshing = (async () => {
      if (!saved.refreshToken || saved.refreshExpiresAt <= this.now()) throw new GitHubUpdateError('sign-in-required', 'GitHub authorization expired. Sign in again.');
      const generation = this.generation;
      const data = await this.oauth('oauth/access_token', { grant_type: 'refresh_token', refresh_token: saved.refreshToken });
      if (generation !== this.generation) throw new GitHubUpdateError('cancelled', 'GitHub authorization changed.');
      if (data.error) throw new GitHubUpdateError('sign-in-required', 'GitHub authorization expired or was revoked. Sign in again.');
      await this.saveTokens(data); return data.access_token;
    })().catch(error => { if (error.code === 'sign-in-required') this.access = 'sign-in-required'; throw error; }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async api(path, { query, ...options } = {}) {
    if (path !== '/user' && !/^\/repos\/DiaMods\/DiaPlus(?:\/[a-zA-Z0-9/_-]+)?$/.test(path)) throw new GitHubUpdateError('destination', 'Refusing an unrelated GitHub API destination.');
    const search = query ? '?' + new URLSearchParams(query).toString() : '';
    const get = async token => this.request(`https://api.github.com${path}${search}`, { ...options,
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10', ...options.headers, authorization: `Bearer ${token}` } });
    let response = await get(await this.token());
    if (response.status === 401) response = await get(await this.token(true));
    if (response.status === 401) { this.access = 'sign-in-required'; throw new GitHubUpdateError('sign-in-required', 'GitHub authorization was revoked. Sign in again.'); }
    if (response.status === 429 || response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))) {
      throw new GitHubUpdateError('rate-limited', 'GitHub rate limit reached. Try again later.');
    }
    if ([403, 404].includes(response.status)) { this.access = 'denied'; throw new GitHubUpdateError('access-denied', 'This GitHub account cannot read DiaMods/DiaPlus. Ask the owner for access or authorize the organization’s required access policy. Dia+ and manual installers still work.'); }
    if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status)) throw new GitHubUpdateError('network', 'GitHub could not complete the update request. Try again later.');
    return response;
  }
  async verifyAccess() {
    try {
    const generation = this.generation;
    const response = await this.api('/repos/DiaMods/DiaPlus');
    const repo = await this.json(response);
    if (repo.full_name !== updateRepository || repo.private !== true || repo.permissions?.pull === false) throw new GitHubUpdateError('access-denied', 'The configured private repository is unavailable to this account.');
    const user = await this.json(await this.api('/user'));
    if (typeof user.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(user.login)) throw new GitHubUpdateError('response', 'GitHub returned an invalid account identity.');
    if (generation !== this.generation) throw new GitHubUpdateError('cancelled', 'GitHub authorization changed.');
    this.login = user.login; this.access = 'authorized'; return this.status();
    } catch (error) {
      this.access = error.code === 'access-denied' ? 'denied' : error.code === 'sign-in-required' ? 'sign-in-required' : error.code ?? 'unknown';
      throw error;
    }
  }
  async status() {
    if (!this.clientID) return { configured: false, signedIn: false, access: 'configuration-required', repository: updateRepository, pending: false };
    const saved = await this.store.get();
    return { configured: Boolean(this.clientID), signedIn: Boolean(saved?.accessToken), login: saved?.accessToken ? this.login : null, access: saved?.accessToken ? this.access : 'sign-in-required', repository: updateRepository, ...this.challenge() };
  }
  async signOut() {
    this.cancel();
    // Finish an in-flight rotation before deleting so it cannot restore a login.
    await this.refreshing?.catch(() => {}); await this.polling?.catch(() => {});
    await this.store.delete(); this.access = 'sign-in-required'; this.login = null;
    return this.status();
  }
}
