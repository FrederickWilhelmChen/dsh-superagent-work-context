/**
 * The plugin's HTTP surface below `/plugin/feishu`.
 *
 * Every route answers 200 with an `{ok, data}` envelope so the browser only
 * ever branches on one field; the two exceptions are the OAuth callback, which
 * renders a page for the human in the browser, and the media route, which
 * answers with bytes because that is what an `<img src>` needs.
 *
 * @module dsh-feishu-plugin/plugin/routes
 */

import { summarizeChat } from '../summary.mjs';
import {
  DEFAULT_BASE_URL,
  FeishuError,
  REQUIRED_SCOPES,
  assertConfigured,
  missingScopes,
  readTokenScopes,
} from '../feishu.mjs';
import {
  API_PREFIX,
  CONFIGURE_COMMAND,
  DEFAULT_MESSAGE_LIMIT,
  DEFAULT_OAUTH_STATE_PREFIX,
  MAX_MEDIA_BYTES,
  MEDIA_FILE_KEY,
  MEDIA_MESSAGE_ID,
  SETTINGS_NAMESPACE,
  TASKS_ERROR_TTL_MS,
  TASKS_TTL_MS,
  parseCallbackDenial,
  parseCallbackInput,
  planTaskRead,
  readJsonBody,
  safeFileName,
  sendJson,
  toErrorPayload,
} from './support.mjs';

/**
 * Build the route handler over one plugin's cache, client, and read face.
 *
 * @param {object} deps - route dependencies.
 * @returns {(req: any, res: any) => Promise<void>} the prefix handler.
 */
export function createRoutes(deps) {
  const { ctx, logger, client, cache, current, patchSettings, ensureUserToken, readTasks, readChats, readTranscript, resolveSelection } = deps;

  // ── routes ────────────────────────────────────────────────────────────────
  /** Read the panel's whole backing state in one round trip. */
  async function handleState() {
    const config = current();
    const configured = typeof config.appId === 'string' && config.appId.length > 0
      && typeof config.appSecret === 'string' && config.appSecret.length > 0;
    const userLoggedIn = await ensureUserToken().catch(() => false);
    const selection = resolveSelection();
    // A token freezes its permissions at authorization time, so "the console
    // has the permission" and "this token has the permission" are different
    // facts. Reporting both is what lets the panel say which one to fix.
    const grantedScopes = readTokenScopes(config.userToken);
    // This is the panel's only opening request, so a cold cache has to be filled
    // here. Reading nothing and serving an empty list is how the panel came to
    // announce "no open tasks" for a user with twenty of them. `planTaskRead`
    // also answers `read` for a remembered failure whose window has passed, so
    // an outage cannot outlive itself in the cache.
    if (configured && planTaskRead(cache, Date.now()) === 'read') {
      const result = await readTasks().catch((error) => {
        logger.warn('state: task read failed', toErrorPayload(error).message);
        return { items: [], source: undefined, notice: undefined, error: toErrorPayload(error).message };
      });
      // `readTasks` records what it learns itself, including a failure it does
      // not cache. Only a throw it could not turn into a result is recorded
      // here — and never as a loaded list, so the next state read retries
      // instead of serving the failure from the cache.
      if (result.source !== undefined) {
        cache.tasks = result.items;
        cache.tasksSource = result.source;
        cache.tasksNotice = result.notice;
        // Only a read that produced an answer may stamp the data clock. An
        // errored read that also returned something (the task-list fallback
        // answering while the primary source failed) must not be treated as a
        // fresh list: that stamp would hold the *retry* off for the whole data
        // TTL, instead of the short window a failure gets.
        if (result.error === undefined) cache.tasksAt = Date.now();
      }
      if (result.error !== undefined) {
        cache.tasksError = result.error;
        cache.tasksErrorAt = Date.now();
        // A remembered failure outranks an older success stamp, or the panel
        // would keep serving the stale list and hide why it is stale.
        cache.tasksAt = 0;
      }
    }
    return {
      configured,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      userLoggedIn,
      userName: typeof config.userName === 'string' ? config.userName : '',
      selection,
      llmAvailable: typeof ctx.get('llm')?.stream === 'function',
      apiPrefix: API_PREFIX,
      settingsNamespace: SETTINGS_NAMESPACE,
      // The panel shows this command verbatim: there is no settings-page form
      // for a third-party namespace, so the path forward must be copy-able.
      configureCommand: CONFIGURE_COMMAND,
      settingsPath: '$DSH_HOME/settings.yaml',
      requiredScopes: REQUIRED_SCOPES,
      ...grantedScopes === undefined
        ? {}
        : { grantedScopes, missingScopes: missingScopes(grantedScopes, REQUIRED_SCOPES) },
      tasks: cache.tasks ?? [],
      tasksSource: cache.tasksSource,
      tasksNotice: cache.tasksNotice,
      // `tasks` empty has three possible meanings — nothing is open, the read
      // failed, or nobody has fetched yet — and the panel must not present the
      // second as the first. `tasksLoaded` is true once a read produced the list
      // (even an empty one); `tasksError` carries the reason when a read failed
      // instead.
      tasksLoaded: cache.tasks !== undefined || cache.tasksError !== undefined,
      ...cache.tasksError === undefined ? {} : { tasksError: cache.tasksError },
      chats: cache.chats ?? [],
      // Who the panel is acting as. The chat view right-aligns this person's own
      // messages, and `open_id` is the only identity a message row carries.
      selfId: typeof config.userId === 'string' ? config.userId : '',
      selfAvatar: typeof config.userAvatar === 'string' && config.userAvatar.length > 0 ? config.userAvatar : undefined,
    };
  }

  /** Finish the OAuth flow from an explicit code, or from a pasted callback URL. */
  async function handleAuthComplete(body) {
    const config = current();
    assertConfigured(config);
    const pasted = body?.callbackUrl ?? body?.code ?? '';
    const parsed = parseCallbackInput(pasted);
    if (parsed === undefined) {
      // A consent-page denial comes back as `error=...` with no code; say that
      // instead of blaming the paste.
      const denial = parseCallbackDenial(pasted);
      if (denial !== undefined) {
        throw new FeishuError(`飞书授权被拒绝：${denial.description ?? denial.error}`, {
          hint: '如果是误操作，重新点「打开授权页」并在飞书里点「授权」即可。',
        });
      }
      throw new FeishuError('没有识别出授权码', {
        hint: '请在飞书授权页完成授权后，把浏览器地址栏里完整的回调 URL 粘贴到输入框（其中包含 code 参数）。',
      });
    }
    const bundle = await client.exchangeCode({
      code: parsed.code,
      ...typeof config.oauthRedirectUri === 'string' && config.oauthRedirectUri.length > 0 ? { redirectUri: config.oauthRedirectUri } : {},
    });
    await patchSettings({
      userToken: bundle.accessToken,
      ...bundle.refreshToken === undefined ? {} : { refreshToken: bundle.refreshToken },
      userTokenExpiresAt: Date.now() + bundle.expiresIn * 1000,
    });
    logger.info('user_access_token acquired');
    // The token's own payload carries only scope/exp, so who this user *is* has
    // to be asked for — with the token just received, not with whatever the
    // settings document happens to expose yet. Best-effort: the login itself
    // succeeded either way, and without it the panel simply cannot tell which
    // bubbles are the user's own.
    try {
      const self = await client.getUserInfo({ accessToken: bundle.accessToken });
      await patchSettings({
        ...self.id.length === 0 ? {} : { userId: self.id },
        ...self.name.length === 0 ? {} : { userName: self.name },
        userAvatar: self.avatar ?? '',
      });
    } catch (error) {
      logger.warn('could not read the authorized user profile', toErrorPayload(error).message);
    }
    cache.tasks = undefined;
    return { scope: bundle.scope ?? '', expiresIn: bundle.expiresIn };
  }

  /** The OAuth callback, for deployments whose redirect URI is whitelisted. */
  async function handleAuthCallback(url, res) {
    const code = url.searchParams.get('code');
    if (code === null || code.length === 0) {
      sendJson(res, 200, { ok: false, error: { message: `回调里没有 code：${url.search}` } });
      return;
    }
    try {
      await handleAuthComplete({ code });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>飞书授权完成</title><body style="font:14px system-ui;padding:32px">飞书授权完成，可以关闭本页并回到 DSH 面板。</body>');
    } catch (error) {
      sendJson(res, 200, { ok: false, error: toErrorPayload(error) });
    }
  }

  /**
   * Relay one message resource (an image or a file) to the browser.
   *
   * Why a relay at all: the bytes live behind the Feishu API and need a tenant
   * token, and the panel cannot attach one to an `<img src>`. The host builds
   * the Feishu URL itself from validated ids, so this is a two-parameter lookup
   * into the messages the bot can see — not an open URL fetcher.
   *
   * @param {import('node:http').IncomingMessage} req - incoming request (carries an optional `Range`).
   * @param {import('node:http').ServerResponse} res - response to write.
   * @param {URL} url - parsed request URL.
   */
  async function handleMedia(req, res, url) {
    const messageId = url.searchParams.get('messageId') ?? '';
    const fileKey = url.searchParams.get('fileKey') ?? '';
    const type = url.searchParams.get('type') ?? 'image';
    if (!MEDIA_MESSAGE_ID.test(messageId) || !MEDIA_FILE_KEY.test(fileKey) || (type !== 'image' && type !== 'file')) {
      sendJson(res, 400, { ok: false, error: { message: '消息资源参数不合法（messageId / fileKey / type）' } });
      return;
    }
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const resource = await client.getMessageResource({ messageId, fileKey, type, range });
    if (resource.buffer.byteLength > MAX_MEDIA_BYTES) {
      sendJson(res, 413, {
        ok: false,
        error: {
          message: `这个资源有 ${Math.round(resource.buffer.byteLength / 1024 / 1024)} MB，超过 ${MAX_MEDIA_BYTES / 1024 / 1024} MB 上限，没有转发`,
          hint: '可以在飞书里直接打开这条消息查看原文件。',
        },
      });
      return;
    }
    const headers = {
      'content-type': resource.contentType ?? (type === 'image' ? 'application/octet-stream' : 'application/octet-stream'),
      'content-length': String(resource.buffer.byteLength),
      // The bytes of one message resource never change, and the ids are unique
      // per message, so the browser may keep them for the session.
      'cache-control': 'private, max-age=86400',
      'content-disposition': type === 'image' ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(url.searchParams.get('name'), fileKey))}`,
    };
    if (resource.contentRange !== undefined) headers['content-range'] = resource.contentRange;
    if (resource.status === 206) {
      res.writeHead(206, headers);
    } else {
      res.writeHead(200, headers);
    }
    res.end(resource.buffer);
  }

  /**
   * Dispatch one plugin API request.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   */
  async function handleRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = url.pathname.slice(API_PREFIX.length).replace(/\/$/, '') || '/';
    try {
      if (req.method === 'GET' && route === '/api/auth/callback') {
        await handleAuthCallback(url, res);
        return;
      }
      // Ahead of the body read and outside the JSON envelope below: this route
      // answers with bytes, which is what an `<img src>` needs.
      if (req.method === 'GET' && route === '/api/media') {
        await handleMedia(req, res, url);
        return;
      }
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      /** @type {any} */
      let data;
      if (req.method === 'GET' && route === '/api/state') {
        data = await handleState();
      } else if (req.method === 'POST' && route === '/api/tasks/refresh') {
        data = await readTasks({ force: true });
      } else if (req.method === 'POST' && route === '/api/tasks/complete') {
        const taskGuid = String(body?.id ?? '');
        if (taskGuid.length === 0) throw new FeishuError('缺少任务 id');
        await client.completeTask({ taskGuid, completed: body?.completed !== false });
        // The write invalidated the list, and a failure remembered from before
        // it is no longer news about what is on screen.
        cache.tasks = undefined;
        cache.tasksError = undefined;
        cache.tasksErrorAt = undefined;
        data = { id: taskGuid };
      } else if (req.method === 'POST' && route === '/api/chats/refresh') {
        data = { chats: await readChats({ force: true }) };
      } else if (req.method === 'POST' && route === '/api/messages') {
        data = await readTranscript({ chatId: body?.chatId, limit: body?.limit, hours: body?.hours });
      } else if (req.method === 'POST' && route === '/api/summarize') {
        const transcript = await readTranscript({ chatId: body?.chatId, limit: body?.limit, hours: body?.hours });
        // Rows with no text (a recalled message) are still messages on screen,
        // but they are not something a model can summarize.
        if (transcript.textCount === 0) {
          throw new FeishuError('这个群在选定时间范围内没有可总结的文本消息', {
            hint: '可以换一个群，或把时间范围调大。',
          });
        }
        const summary = await summarizeChat({
          llm: ctx.get('llm'),
          input: {
            chatName: transcript.chatName,
            transcript: transcript.transcript,
            messageCount: transcript.messageCount,
            truncated: transcript.truncated,
          },
          selection: resolveSelection(),
        });
        data = { transcript: { ...transcript, transcript: undefined }, summary };
      } else if (req.method === 'GET' && route === '/api/auth/status') {
        data = await handleState();
      } else if (req.method === 'POST' && route === '/api/auth/url') {
        assertConfigured(current());
        const config = current();
        const prefix = typeof config.oauthStatePrefix === 'string' ? config.oauthStatePrefix : DEFAULT_OAUTH_STATE_PREFIX;
        data = {
          url: client.authorizeUrl({
            ...typeof config.oauthRedirectUri === 'string' && config.oauthRedirectUri.length > 0 ? { redirectUri: config.oauthRedirectUri } : {},
            // Prefixed so a shared callback endpoint can recognize this flow;
            // still just a random nonce, because this plugin does not compare
            // state on the way back (the code is single-use and short-lived).
            state: `${prefix}${Math.random().toString(36).slice(2, 12)}`,
          }),
          scopes: undefined,
        };
      } else if (req.method === 'POST' && route === '/api/auth/complete') {
        data = await handleAuthComplete(body);
      } else if (req.method === 'POST' && route === '/api/auth/logout') {
        await patchSettings({ userToken: '', refreshToken: '', userTokenExpiresAt: 0 });
        cache.tasks = undefined;
        cache.tasksError = undefined;
        cache.tasksErrorAt = undefined;
        data = { ok: true };
      } else {
        sendJson(res, 404, { ok: false, error: { message: `未知接口 ${req.method} ${url.pathname}` } });
        return;
      }
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      const payload = toErrorPayload(error);
      logger.warn(`${req.method} ${url.pathname} failed: ${payload.message}`);
      sendJson(res, 200, { ok: false, error: payload });
    }
  }

  return { handleRequest };
}
