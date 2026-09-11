/**
 * The plugin's shared vocabulary: Cordis identity, the settings schema, the
 * read-cache decision, and the small HTTP/parsing helpers both the read layer
 * and the route layer use.
 *
 * Nothing here touches the Feishu client or the plugin's cache — this is the
 * layer every other module imports, so it must never import one of them back.
 *
 * @module dsh-feishu-plugin/plugin/support
 */

import z from '@deepseek-ai/schemastery';
import { DEFAULT_BASE_URL, DEFAULT_OAUTH_TOKEN_URL, FeishuError } from '../feishu.mjs';

export const name = 'feishu-plugin';

/** Services this plugin cannot work without. */
export const inject = ['webServer', 'settings'];

/** Route prefix owned by this plugin; everything it serves lives below it. */
export const API_PREFIX = '/plugin/feishu';

/** Settings namespace owned by this plugin (the `feishu-plugin:` section of settings.yaml). */
export const SETTINGS_NAMESPACE = 'feishu-plugin';

/**
 * How a user configures this plugin.
 *
 * Exposed in `/api/state` so the panel can show the exact command rather than a
 * settings-page path that does not exist for a third-party namespace: the Web
 * settings page draws a card only for the namespaces it ships a card for.
 */
export const CONFIGURE_COMMAND = 'node scripts/apply-settings.mjs --app-id <App ID> --app-secret <App Secret>';

/**
 * Default marker on the OAuth `state` parameter.
 *
 * A Feishu app has one redirect-URL list shared by every integration using it,
 * so a deployment that already runs an OAuth callback for this app receives
 * this plugin's authorizations too. The prefix lets that callback recognize a
 * DSH-flow redirect and forward it instead of trying to parse it as its own.
 */
export const DEFAULT_OAUTH_STATE_PREFIX = 'dsh-feishu-';

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Largest message resource this plugin will relay, in bytes.
 *
 * Feishu allows up to 100 MB; the panel only ever shows a thumbnail or offers a
 * download, and buffering a 100 MB body in the host process to hand it to one
 * browser tab is a good way to run the GUI out of memory. Anything larger gets
 * a message instead of a transfer.
 */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

/** Shapes the message-resource route accepts; anything else is rejected before a request is made. */
const MEDIA_MESSAGE_ID = /^om_[A-Za-z0-9_-]{1,64}$/;
const MEDIA_FILE_KEY = /^(img|file)_[A-Za-z0-9_-]{1,128}$/;
export { MAX_MEDIA_BYTES, MEDIA_FILE_KEY, MEDIA_MESSAGE_ID };

/** How long a loaded task list is served before it is read from Feishu again. */
export const TASKS_TTL_MS = 60_000;

/**
 * How long a failed task read is reported again before it is retried.
 *
 * Short on purpose: long enough not to hammer a failing upstream on every poll,
 * short enough that a transient outage does not stay on screen after it ends.
 */
export const TASKS_ERROR_TTL_MS = 15_000;

/**
 * Decide what a plain (non-forced) task read does with the cache.
 *
 * An empty task list on screen has three different meanings, so this has three
 * answers. `cache`: a fresh list was loaded, serve it. `remember`: a read
 * failed moments ago, so re-report that failure instead of hammering an
 * upstream that is probably still down. `read`: nothing usable is cached, or
 * the remembered failure has aged out — ask Feishu.
 *
 * Both the state route and the read path go through this one decision, because
 * the two drifting apart is how a transient failure became permanent: the route
 * refused to read while a remembered error existed, and nothing ever cleared
 * it.
 *
 * @param {{ tasks?: any[], tasksSource?: string, tasksAt?: number, tasksError?: string, tasksErrorAt?: number }} cache - task cache snapshot.
 * @param {number} now - current epoch ms.
 * @returns {'cache'|'remember'|'read'} the decision.
 */
export function planTaskRead(cache, now) {
  if (cache.tasks !== undefined && cache.tasksSource !== undefined
    && now - (cache.tasksAt ?? 0) < TASKS_TTL_MS) {
    return 'cache';
  }
  if (cache.tasksError !== undefined
    && now - (cache.tasksErrorAt ?? cache.tasksAt ?? 0) < TASKS_ERROR_TTL_MS) {
    return 'remember';
  }
  return 'read';
}

/** Default page of each collection read per refresh. */
const DEFAULT_TASK_LIMIT = 100;
const DEFAULT_CHAT_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 200;
export { DEFAULT_CHAT_LIMIT, DEFAULT_MESSAGE_LIMIT, DEFAULT_TASK_LIMIT };

/**
 * Plugin configuration. Every field is also a settings-card row, so the user
 * configures the plugin from the GUI rather than from YAML.
 */
export const Config = z.object({
  appId: z.string().default(''),
  appSecret: z.string().role('secret').default(''),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  /** OAuth token endpoint; separate because it lives on the accounts host, not the API origin. */
  oauthTokenUrl: z.string().default(DEFAULT_OAUTH_TOKEN_URL),
  oauthRedirectUri: z.string().default(''),
  /**
   * Prefix on the OAuth `state` this plugin sends.
   *
   * A deployment whose Feishu app must keep its own callback domain receives
   * every authorization on that one URL — including this plugin's — so the
   * callback owner needs a way to tell the flows apart without guessing from
   * the payload's shape. The prefix is that marker.
   */
  oauthStatePrefix: z.string().default(DEFAULT_OAUTH_STATE_PREFIX),
  /** user_access_token persisted across restarts; written by the OAuth callback. */
  userToken: z.string().role('secret').default(''),
  /** Refresh token for the above; Feishu invalidates it on every use. */
  refreshToken: z.string().role('secret').default(''),
  /** Epoch ms at which `userToken` stops being usable. */
  userTokenExpiresAt: z.number().default(0),
  /** Display name of the authorized user, for the panel header. */
  userName: z.string().default(''),
  /** open_id of the authorized user; machine-written, so the panel can right-align its own messages. */
  userId: z.string().default(''),
  /** Avatar URL of the authorized user; machine-written, best-effort. */
  userAvatar: z.string().default(''),
  summaryProvider: z.string().default(''),
  summaryModel: z.string().default(''),
  maxMessages: z.number().step(1).min(10).max(2000).default(DEFAULT_MESSAGE_LIMIT),
  toolsEnabled: z.boolean().default(true),
});

/**
 * Reply with a JSON document. Every route answers 200 with an `ok` envelope so
 * the browser only ever has to branch on one field; a non-200 is reserved for
 * "this route does not exist".
 * @param {import('node:http').ServerResponse} res - response to write.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  });
  res.end(payload);
}
export { sendJson };

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} req - request to drain.
 * @returns {Promise<any>} parsed body, or `{}` for an empty body.
 * @throws {FeishuError} when the body is too large or is not JSON.
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new FeishuError('请求体过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new FeishuError('请求体不是合法 JSON');
  }
}
export { readJsonBody };

/**
 * A download filename that is safe to put in a response header.
 *
 * The name arrives from the message payload, through a query string, so it is
 * untrusted: strip control characters and anything that would let it escape a
 * directory or break out of the header, cap the length, and fall back to the
 * resource key. The caller percent-encodes the result again for the RFC 5987
 * `filename*` form, so this only has to be sane, not escaped.
 *
 * @param {string | null} name - requested name.
 * @param {string} fallback - name to use when nothing usable remains.
 * @returns {string} a safe filename.
 */
function safeFileName(name, fallback) {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}
export { safeFileName };

/**
 * Extract an authorization code from whatever the user pasted: a bare code, a
 * full callback URL, or a query string. Feishu's redirect_uri must be
 * whitelisted in the app console, so pasting the callback back is the path that
 * works for a loopback-only deployment.
 * @param {string} input - pasted value.
 * @returns {{ code: string, state?: string } | undefined} parsed pieces.
 */
export function parseCallbackInput(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text.length === 0) return undefined;
  const fromQuery = (query) => {
    const code = query.get('code');
    if (code === null || code.length === 0) return undefined;
    const state = query.get('state');
    return { code, ...state === null || state.length === 0 ? {} : { state } };
  };
  if (text.startsWith('http://') || text.startsWith('https://')) {
    try {
      return fromQuery(new URL(text).searchParams);
    } catch {
      return undefined;
    }
  }
  if (text.includes('code=')) {
    return fromQuery(new URLSearchParams(text.replace(/^\?/, '')));
  }
  if (/^[A-Za-z0-9_-]{4,}$/.test(text)) return { code: text };
  return undefined;
}

/**
 * Read the OAuth denial a callback carries, when it carries one.
 *
 * A user who declines on the Feishu consent page is redirected back with
 * `error`/`error_description` and no `code`. Reporting that as "no code found"
 * hides the actual cause from the person reading it, so the denial is named.
 *
 * @param {string} input - pasted value.
 * @returns {{ error: string, description?: string } | undefined} the denial.
 */
export function parseCallbackDenial(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text.length === 0) return undefined;
  /** @param {URLSearchParams} query - candidate query. */
  const fromQuery = (query) => {
    const error = query.get('error');
    if (error === null || error.length === 0) return undefined;
    const description = query.get('error_description');
    return { error, ...description === null || description.length === 0 ? {} : { description } };
  };
  if (text.startsWith('http://') || text.startsWith('https://')) {
    try {
      return fromQuery(new URL(text).searchParams);
    } catch {
      return undefined;
    }
  }
  if (text.includes('error=')) return fromQuery(new URLSearchParams(text.replace(/^\?/, '')));
  return undefined;
}

/**
 * Summarize a thrown value into the API error envelope.
 * @param {unknown} error - thrown value.
 * @returns {{ code?: number | string, message: string, hint?: string }} envelope error.
 */
export function toErrorPayload(error) {
  if (error instanceof FeishuError) {
    return {
      message: error.message,
      ...error.code === undefined ? {} : { code: error.code },
      ...error.hint === undefined ? {} : { hint: error.hint },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { message };
}
