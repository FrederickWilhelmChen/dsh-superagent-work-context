/**
 * Feishu open-API endpoints, one function per capability the plugin needs.
 *
 * The credential plane and the request helpers come from
 * {@link ./transport.mjs}; what is left here is what each call *is* — the path,
 * the query, and how the answer is read.
 *
 * @module dsh-feishu-plugin/feishu/api
 */

import {
  DEFAULT_BASE_URL,
  FeishuError,
  OAUTH_AUTHORIZE_URL,
  REQUIRED_SCOPES,
  apiError,
  assertConfigured,
  buildUrl,
} from './common.mjs';
import { createTransport, delay, readJson } from './transport.mjs';

/**
 * Create one client bound to a config getter.
 *
 * `getConfig()` is read on every request so a settings change takes effect
 * without recreating the client.
 *
 * @param {object} options - construction options.
 * @param {() => { appId?: string, appSecret?: string, baseUrl?: string, userToken?: string }} options.getConfig - live plugin config.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (tests inject a stub).
 * @param {(msg: string, detail?: unknown) => void} [options.warn] - diagnostic sink.
 * @returns {object} client with token, task, chat, and message operations.
 */
export function createFeishuClient({ getConfig, fetchImpl = fetch, warn = () => {} }) {
  const transport = createTransport({ getConfig, fetchImpl, warn });

  /**
   * Follow a page token to completion, bounded by `limit` items and a page cap.
   *
   * Truncation is reported only when the answer is actually partial: stopping
   * because the item cap was reached *and* the server still offers another
   * page. Reaching the cap exactly as the data ends is a complete answer, and
   * the caller must not be told otherwise.
   *
   * @template T
   * @param {(pageToken: string | undefined) => Promise<{ items: T[], hasMore: boolean, pageToken: string | undefined }>} fetchPage - one page.
   * @param {number} limit - maximum items to collect.
   * @returns {Promise<{ items: T[], truncated: boolean }>} collected items.
   */
  async function paginate(fetchPage, limit) {
    /** @type {T[]} */
    const items = [];
    let pageToken;
    let guard = 0;
    let more = false;
    while (guard < 50) {
      const page = await fetchPage(pageToken);
      more = page.hasMore === true;
      items.push(...page.items);
      guard += 1;
      if (items.length >= limit || !more || page.pageToken === undefined || page.pageToken === pageToken) break;
      pageToken = page.pageToken;
      await delay(0);
    }
    return { items: items.slice(0, limit), truncated: more && items.length >= limit };
  }

  /**
   * List the chats the bot is in.
   * @param {{ limit?: number }} [options] - item cap (default 100).
   * @returns {Promise<{ items: any[], truncated: boolean }>} raw chat rows.
   */
  function listChats(options = {}) {
    const limit = options.limit ?? 100;
    return paginate(async (pageToken) => {
      const payload = await transport.getJson('/open-apis/im/v1/chats', {
        what: '获取机器人所在群列表',
        prefer: 'tenant',
        query: { page_size: Math.min(100, limit), page_token: pageToken, sort_type: 'ByCreateTimeAsc' },
      });
      const data = payload?.data ?? {};
      return {
        items: Array.isArray(data.items) ? data.items : [],
        hasMore: data.has_more === true,
        pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
      };
    }, limit);
  }

  /**
   * Read one page of chat history.
   * @param {{ chatId: string, startTime?: number, endTime?: number, pageSize?: number, pageToken?: string, order?: 'asc' | 'desc' }} options - request options.
   * @returns {Promise<{ items: any[], hasMore: boolean, pageToken: string | undefined }>} raw messages.
   */
  async function listMessages(options) {
    const payload = await transport.getJson('/open-apis/im/v1/messages', {
      what: '获取会话历史消息',
      prefer: 'auto',
      query: {
        container_id_type: 'chat',
        container_id: options.chatId,
        start_time: options.startTime === undefined ? undefined : Math.floor(options.startTime / 1000),
        end_time: options.endTime === undefined ? undefined : Math.floor(options.endTime / 1000),
        sort_type: options.order === 'desc' ? 'ByCreateTimeDesc' : 'ByCreateTimeAsc',
        page_size: Math.min(50, options.pageSize ?? 50),
        page_token: options.pageToken,
      },
    });
    const data = payload?.data ?? {};
    return {
      items: Array.isArray(data.items) ? data.items : [],
      hasMore: data.has_more === true,
      pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
    };
  }

  /**
   * Read the newest `limit` messages of a chat, newest-first paging reversed
   * back into chronological order for prompting.
   * @param {{ chatId: string, limit?: number, startTime?: number, endTime?: number }} options - request options.
   * @returns {Promise<{ items: any[], truncated: boolean }>} raw messages, oldest first.
   */
  async function listRecentMessages(options) {
    const limit = options.limit ?? 200;
    const result = await paginate(async (pageToken) => {
      const page = await listMessages({
        chatId: options.chatId,
        startTime: options.startTime,
        endTime: options.endTime,
        pageSize: 50,
        pageToken,
        // Descending paging is how "the newest N" stays bounded: walking
        // ascending from the beginning of a long-lived group would spend the
        // whole budget on ancient messages.
        order: 'desc',
      });
      return { items: page.items, hasMore: page.hasMore, pageToken: page.pageToken };
    }, limit);
    return { items: [...result.items].reverse(), truncated: result.truncated };
  }

  /**
   * List the authorizing user's own tasks ("我负责的").
   * Only a user token may call this endpoint.
   * @param {{ limit?: number, completed?: boolean }} [options] - filters.
   * @returns {Promise<{ items: any[], truncated: boolean }>} raw tasks.
   */
  function listMyTasks(options = {}) {
    const limit = options.limit ?? 100;
    return paginate(async (pageToken) => {
      const payload = await transport.getJson('/open-apis/task/v2/tasks', {
        what: '获取「我负责的」任务',
        prefer: 'user',
        query: { type: 'my_tasks', page_size: Math.min(100, limit), page_token: pageToken, completed: options.completed },
      });
      const data = payload?.data ?? {};
      return {
        items: Array.isArray(data.items) ? data.items : [],
        hasMore: data.has_more === true,
        pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
      };
    }, limit);
  }

  /**
   * List task lists readable by the current credential.
   *
   * A failure is reported on the result rather than thrown: this call is the
   * fallback used when "assigned to me" cannot be read, so throwing would turn
   * a degraded answer into no answer at all. The flags keep the difference
   * between "there are none" and "none could be read" visible to the caller —
   * silently collapsing those two is what made an unreadable list look like an
   * empty one.
   *
   * @param {{ limit?: number }} [options] - item cap.
   * @returns {Promise<{ items: any[], truncated: boolean, tasklistsUnreadable?: true, tasklistsError?: string }>} raw task lists.
   */
  async function listTasklists(options = {}) {
    const limit = options.limit ?? 50;
    try {
      return await paginate(async (pageToken) => {
        const payload = await transport.getJson('/open-apis/task/v2/tasklists', {
          what: '获取任务清单列表',
          prefer: 'auto',
          query: { page_size: Math.min(100, limit), page_token: pageToken },
        });
        const data = payload?.data ?? {};
        return {
          items: Array.isArray(data.items) ? data.items : [],
          hasMore: data.has_more === true,
          pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
        };
      }, limit);
    } catch (error) {
      return { items: [], truncated: false, tasklistsUnreadable: true, tasklistsError: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * List the tasks inside one task list.
   * @param {{ tasklistGuid: string, limit?: number, completed?: boolean }} options - request options.
   * @returns {Promise<{ items: any[], truncated: boolean }>} raw tasks.
   */
  function listTasklistTasks(options) {
    const limit = options.limit ?? 100;
    return paginate(async (pageToken) => {
      const payload = await transport.getJson(`/open-apis/task/v2/tasklists/${encodeURIComponent(options.tasklistGuid)}/tasks`, {
        what: '获取清单任务列表',
        prefer: 'auto',
        query: { page_size: Math.min(100, limit), page_token: pageToken, completed: options.completed },
      });
      const data = payload?.data ?? {};
      return {
        items: Array.isArray(data.items) ? data.items : [],
        hasMore: data.has_more === true,
        pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
      };
    }, limit);
  }

  /**
   * Exchange an OAuth authorization code for a user access token.
   * @param {{ code: string, redirectUri?: string }} options - code from the authorize redirect.
   * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn: number, refreshExpiresIn?: number, scope?: string }>} token bundle.
   */
  async function exchangeCode(options) {
    const config = getConfig();
    assertConfigured(config);
    const payload = await transport.postJson(config.oauthTokenUrl ?? DEFAULT_OAUTH_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: config.appId,
      client_secret: config.appSecret,
      code: options.code,
      ...options.redirectUri === undefined ? {} : { redirect_uri: options.redirectUri },
    }, { what: '用授权码换取 user_access_token' });
    const accessToken = payload?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new FeishuError(`换取 user_access_token 失败：${payload?.error_description ?? payload?.error ?? '响应中没有 access_token'}`, {
        code: payload?.code,
        hint: '授权码有效期仅 5 分钟且只能用一次，请重新点「登录飞书」获取新链接。',
      });
    }
    return {
      accessToken,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
      expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : 7200,
      refreshExpiresIn: typeof payload.refresh_expires_in === 'number' ? payload.refresh_expires_in : undefined,
      scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    };
  }

  /**
   * Refresh an expired user access token. The old refresh token is invalidated
   * by Feishu on success, so the caller must persist the returned one.
   * @param {{ refreshToken: string }} options - the stored refresh token.
   * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn: number }>} new token bundle.
   */
  async function refreshUserToken(options) {
    const config = getConfig();
    assertConfigured(config);
    const payload = await transport.postJson(config.oauthTokenUrl ?? DEFAULT_OAUTH_TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: config.appId,
      client_secret: config.appSecret,
      refresh_token: options.refreshToken,
    }, { what: '刷新 user_access_token' });
    const accessToken = payload?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new FeishuError(`刷新 user_access_token 失败：${payload?.error_description ?? payload?.error ?? '响应中没有 access_token'}`, {
        code: payload?.code,
        hint: '请重新点「登录飞书」授权一次。',
      });
    }
    return {
      accessToken,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
      expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : 7200,
    };
  }

  /**
   * List the human members of one chat, for turning message sender ids into
   * display names.
   *
   * A failure is reported on the result rather than thrown, exactly like
   * {@link listTasklists}: the chat view can still render every message with a
   * shortened id, and losing the whole transcript because the name lookup failed
   * would be a much worse answer than unnamed bubbles.
   *
   * `prefer: 'tenant'` is deliberate. The member list requires the *operator* to
   * be in the chat, and the chats this plugin lists are the ones the **bot** is
   * in — a user token would fail with `232011` for every group the authorized
   * user has not joined.
   *
   * @param {{ chatId: string, limit?: number }} options - chat identity and item cap.
   * @returns {Promise<{ items: Array<{ id: string, name: string }>, truncated: boolean, unreadable?: boolean, error?: string }>} members, or a reason.
   */
  async function listChatMembers(options) {
    const limit = options.limit ?? 500;
    try {
      const result = await paginate(async (pageToken) => {
        const payload = await transport.getJson(`/open-apis/im/v1/chats/${encodeURIComponent(options.chatId)}/members`, {
          what: '获取群成员列表',
          prefer: 'tenant',
          query: { member_id_type: 'open_id', page_size: 100, page_token: pageToken },
        });
        const data = payload?.data ?? {};
        return {
          items: Array.isArray(data.items) ? data.items : [],
          hasMore: data.has_more === true,
          pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
        };
      }, limit);
      const items = [];
      for (const member of result.items) {
        const id = String(member?.member_id ?? '');
        const name = typeof member?.name === 'string' ? member.name : '';
        if (id.length > 0 && name.length > 0) items.push({ id, name });
      }
      return { items, truncated: result.truncated };
    } catch (error) {
      return { items: [], truncated: false, unreadable: true, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Read the authorized user's own profile.
   *
   * The stored `user_access_token` is an opaque token whose payload carries only
   * `scope`/`exp`, so the open id behind it is unknowable from the token alone.
   * This endpoint needs no scope of its own, which is what makes "which bubbles
   * are mine" answerable without asking the user to authorize anything new.
   *
   * `accessToken` is accepted explicitly because the caller that matters most is
   * the token exchange itself: at that moment the fresh token is in hand while
   * the settings document may not have been re-read yet, so resolving it from
   * the config would race the very write that stored it.
   *
   * @param {{ accessToken?: string }} [options] - token to use instead of the stored one.
   * @returns {Promise<{ id: string, name: string, avatar?: string }>} the user behind the token.
   */
  async function getUserInfo(options = {}) {
    const authorization = typeof options.accessToken === 'string' && options.accessToken.length > 0
      ? `Bearer ${options.accessToken}`
      : await transport.authorizationFor('user');
    const response = await transport.fetch(transport.endpoint('/open-apis/authen/v1/user_info'), {
      method: 'GET',
      headers: { authorization },
    });
    const payload = await readJson(response);
    if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
      throw apiError(response.status, payload, '获取当前用户信息');
    }
    const data = payload?.data ?? {};
    return {
      id: String(data.open_id ?? ''),
      name: typeof data.name === 'string' ? data.name : '',
      avatar: typeof data.avatar_url === 'string' ? data.avatar_url : undefined,
    };
  }

  /**
   * Download one resource (image or file) attached to a message.
   *
   * The response is a binary stream, so this cannot go through `getJson` — that
   * helper reads the body as text and would destroy the bytes. The caller
   * (the plugin's media route) is what validates the ids; this only builds the
   * path, so the URL never comes from user input.
   *
   * @param {{ messageId: string, fileKey: string, type: 'image' | 'file', range?: string }} options - resource identity.
   * @returns {Promise<{ status: number, contentType?: string, contentLength?: string, contentRange?: string, buffer: Buffer }>} the bytes and their metadata.
   */
  async function getMessageResource(options) {
    const config = getConfig();
    const authorization = await transport.authorizationFor('tenant');
    const response = await transport.fetch(buildUrl(config.baseUrl ?? DEFAULT_BASE_URL, `/open-apis/im/v1/messages/${encodeURIComponent(options.messageId)}/resources/${encodeURIComponent(options.fileKey)}`, {
      type: options.type,
    }), {
      method: 'GET',
      headers: {
        authorization,
        ...options.range === undefined ? {} : { range: options.range },
      },
    });
    if (!response.ok) {
      // Feishu answers a failed resource read with a JSON error body, not bytes.
      const payload = await readJson(response);
      throw apiError(response.status, payload, '下载消息资源');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      contentLength: response.headers.get('content-length') ?? undefined,
      contentRange: response.headers.get('content-range') ?? undefined,
      buffer,
    };
  }

  /**
   * Mark one task completed.
   * @param {{ taskGuid: string, completed?: boolean }} options - task identity and target state.
   * @returns {Promise<any>} the updated task.
   */
  async function completeTask(options) {
    const config = getConfig();
    const completed = options.completed !== false;
    const authorization = await transport.authorizationFor('user');
    const response = await transport.fetch(buildUrl(config.baseUrl ?? DEFAULT_BASE_URL, `/open-apis/task/v2/tasks/${encodeURIComponent(options.taskGuid)}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization },
      body: JSON.stringify({
        task: { completed_at: completed ? String(Date.now()) : '0' },
        update_fields: ['completed_at'],
      }),
    });
    const payload = await readJson(response);
    if (!response.ok || (payload?.code !== undefined && payload.code !== 0)) {
      throw apiError(response.status, payload, '更新任务完成状态');
    }
    return payload?.data;
  }


  /**
   * Build the authorize URL the user opens to grant access.
   * @param {{ redirectUri?: string, state?: string }} [options] - redirect target and CSRF state.
   * @returns {string} authorize page URL.
   */
  function authorizeUrl(options = {}) {
    const config = getConfig();
    assertConfigured(config);
    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', config.appId);
    url.searchParams.set('response_type', 'code');
    if (options.redirectUri !== undefined && options.redirectUri.length > 0) {
      url.searchParams.set('redirect_uri', options.redirectUri);
    }
    url.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
    if (options.state !== undefined) url.searchParams.set('state', options.state);
    return url.toString();
  }

  return {
    authorizeUrl,
    completeTask,
    exchangeCode,
    getMessageResource,
    getUserInfo,
    listChatMembers,
    listChats,
    listMessages,
    listMyTasks,
    listRecentMessages,
    listTasklistTasks,
    listTasklists,
    refreshUserToken,
    resetToken: transport.resetToken,
    tenantToken: transport.tenantToken,
    /** Expose the paging helper for the plugin layer's own composite reads. */
    paginate,
  };
}
