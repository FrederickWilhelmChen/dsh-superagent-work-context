/**
 * Credentials and HTTP transport for the Feishu open API.
 *
 * Two credential planes live here because the choice between them is a property
 * of the call, not of the caller: `getJson` takes `prefer` and walks the
 * credential order itself, falling back to the bot token whenever the user token
 * is refused for a reason another credential could satisfy. Everything above
 * this layer just names what it wants.
 *
 * @module dsh-feishu-plugin/feishu/transport
 */

import { DEFAULT_BASE_URL, FeishuError, apiError, assertConfigured, buildUrl } from './common.mjs';

/** Read the response body as JSON without throwing on an empty or non-JSON body. */
export async function readJson(response) {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, msg: text.slice(0, 300) };
  }
}

/** Sleep helper used only by the pagination guard. */
export const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Create the credential cache and request helpers for one client.
 *
 * @param {object} options - construction options.
 * @param {() => { appId?: string, appSecret?: string, baseUrl?: string, userToken?: string }} options.getConfig - live plugin config.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (tests inject a stub).
 * @param {(msg: string, detail?: unknown) => void} [options.warn] - diagnostic sink.
 * @returns {object} transport face used by the endpoint layer.
 */
export function createTransport({ getConfig, fetchImpl = fetch, warn = () => {} }) {
  /** @type {{ key: string, token: string, expiresAt: number, kind: 'tenant' | 'user' } | undefined} */
  let cachedToken;

  /**
   * Drop the cached token. Called whenever credentials change or a call
   * reports the token as expired.
   */
  function resetToken() {
    cachedToken = undefined;
  }

  /** Current credential identity, so a settings change invalidates the cache. */
  function tokenKey(config) {
    return `${config.baseUrl}|${config.appId}|${config.appSecret}`;
  }

  /**
   * Resolve one endpoint against the configured origin.
   *
   * Absolute URLs pass through untouched: the OAuth token endpoint lives on
   * `accounts.feishu.cn`, not on the tenant's API origin, so it must not be
   * joined onto `baseUrl`.
   * @param {string} pathname - absolute URL or open-API path.
   * @returns {string} absolute URL.
   */
  function endpoint(pathname) {
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) return pathname;
    return buildUrl(getConfig().baseUrl ?? DEFAULT_BASE_URL, pathname);
  }

  /**
   * POST a JSON body to the open API.
   * @param {string} pathname - open-API path or an absolute URL.
   * @param {any} body - JSON request body.
   * @param {{ what: string, headers?: Record<string, string> }} options - operation label and extra headers.
   * @returns {Promise<any>} the parsed `data`-bearing payload.
   */
  async function postJson(pathname, body, options) {
    const response = await fetchImpl(endpoint(pathname), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', ...options.headers },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
      throw apiError(response.status, payload, options.what);
    }
    return payload;
  }

  /**
   * Obtain the bot token, reusing it until shortly before it expires.
   * @returns {Promise<string>} tenant access token.
   */
  async function tenantToken() {
    const config = getConfig();
    assertConfigured(config);
    const key = tokenKey(config);
    const now = Date.now();
    if (cachedToken !== undefined && cachedToken.kind === 'tenant' && cachedToken.key === key && cachedToken.expiresAt > now) {
      return cachedToken.token;
    }
    const payload = await postJson('/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: config.appId,
      app_secret: config.appSecret,
    }, { what: '获取 tenant_access_token' });
    const token = payload?.tenant_access_token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new FeishuError('获取 tenant_access_token 失败：响应中没有 token', { hint: '请检查 App ID / App Secret 是否正确。' });
    }
    const ttlSeconds = typeof payload?.expire === 'number' ? payload.expire : 7200;
    cachedToken = { key, token, kind: 'tenant', expiresAt: now + Math.max(60, ttlSeconds - 300) * 1000 };
    return token;
  }

  /**
   * GET an open-API path with one of the two tokens.
   * @param {string} pathname - open-API path.
   * @param {{ query?: Record<string, string | number | boolean | undefined>, what: string, prefer?: 'auto' | 'user' | 'tenant' }} options - request options.
   * @returns {Promise<any>} the parsed payload.
   */
  async function getJson(pathname, options) {
    const config = getConfig();
    const prefer = options.prefer ?? 'auto';
    /** @type {Array<'user' | 'tenant'>} */
    const order = prefer === 'auto' ? ['user', 'tenant'] : [prefer];
    /** @type {unknown[]} */
    const failures = [];
    for (const kind of order) {
      const credential = kind === 'user' ? config.userToken : undefined;
      const token = kind === 'user'
        ? (typeof credential === 'string' && credential.length > 0 ? credential : undefined)
        : await tenantToken();
      if (token === undefined) {
        failures.push(new FeishuError(`没有可用的 ${kind} token`, { hint: '请重新授权登录飞书。' }));
        continue;
      }
      const response = await fetchImpl(buildUrl(config.baseUrl ?? DEFAULT_BASE_URL, pathname, options.query), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await readJson(response);
      if (response.ok && (payload?.code === undefined || payload.code === 0)) return payload;
      const error = apiError(response.status, payload, options.what);
      // A user token that the tenant token could satisfy (or vice versa) must
      // not surface as a failure while another credential still works.
      //
      // `232011` ("operator can not be out of the chat") belongs in this set for
      // the same reason: the panel lists the *bot's* groups, so the authorized
      // user is routinely not a member of the group being read — without this,
      // a transcript would fail even though the bot token can read it.
      if (payload?.code === 99991663 || payload?.code === 99991664 || payload?.code === 232011 || response.status === 401) {
        warn(`feishu: ${kind} token rejected while doing ${options.what}`, payload?.code);
        failures.push(error);
        continue;
      }
      throw error;
    }
    throw failures[0] ?? new FeishuError(`${options.what} 失败：没有可用凭证`);
  }

  /**
   * Resolve the authorization header for one credential kind.
   * @param {'user' | 'tenant'} kind - which token to use.
   * @returns {Promise<string>} `Bearer …` header value.
   */
  async function authorizationFor(kind) {
    if (kind === 'tenant') return `Bearer ${await tenantToken()}`;
    const credential = getConfig().userToken;
    if (typeof credential !== 'string' || credential.length === 0) {
      throw new FeishuError('尚未登录飞书', { hint: '在插件面板点「登录飞书」完成一次授权。' });
    }
    return `Bearer ${credential}`;
  }

  return {
    fetch: fetchImpl,
    getConfig,
    endpoint,
    getJson,
    postJson,
    tenantToken,
    authorizationFor,
    resetToken,
  };
}
