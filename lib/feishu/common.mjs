/**
 * Shared vocabulary of the Feishu client: origins, scopes, error types, and the
 * error-hint table both halves of the plugin translate through.
 *
 * Dependency-free on purpose — this is the layer every other Feishu module
 * imports, so it must never import one of them back.
 *
 * @module dsh-feishu-plugin/feishu/common
 */

export const DEFAULT_BASE_URL = 'https://open.feishu.cn';

/**
 * OAuth token endpoint (v3, client_secret in the body — see
 * user_access_token_v3.md). It lives on the accounts host, not on the tenant's
 * API origin, so it is configured separately.
 */
export const DEFAULT_OAUTH_TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token';

/**
 * @deprecated Import {@link DEFAULT_OAUTH_TOKEN_URL}; kept as the historical name.
 */
export const OAUTH_TOKEN_URL = DEFAULT_OAUTH_TOKEN_URL;

/** OAuth authorize page; the browser is redirected here to obtain a code. */
export const OAUTH_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';

/**
 * Scopes this plugin asks for.
 *
 * `offline_access` is what makes Feishu return a refresh token, without which
 * the login would expire every couple of hours. `task:task:write` is what lets
 * the panel's 完成 button actually complete the task in Feishu — read scope is
 * not enough, and the failure only appears when the button is pressed, so it is
 * requested up front.
 */
export const REQUIRED_SCOPES = [
  'task:task:read',
  'task:task:write',
  'task:tasklist:read',
  'im:chat:readonly',
  'im:message:readonly',
  'im:message.group_msg',
  'offline_access',
];

/**
 * Read the scopes actually baked into a user access token.
 *
 * Feishu freezes a token's permissions at authorization time, so a scope added
 * in the developer console afterwards is absent from every token issued earlier.
 * Reading the claim is the only way to tell "the app lacks this permission"
 * apart from "this token predates it" — a distinction the panel must show,
 * because the fixes differ.
 *
 * @param {unknown} token - a Feishu user_access_token (a JWT).
 * @returns {string[] | undefined} the granted scopes, or undefined when the token carries no readable claim.
 */
export function readTokenScopes(token) {
  if (typeof token !== 'string') return undefined;
  const segment = token.split('.')[1];
  if (segment === undefined || segment.length === 0) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (typeof payload?.scope !== 'string') return undefined;
    return payload.scope.split(/\s+/).filter((scope) => scope.length > 0);
  } catch {
    return undefined;
  }
}

/**
 * @param {string[]} granted - scopes the token actually holds.
 * @param {readonly string[]} required - scopes the plugin needs for its features.
 * @returns {string[]} the required scopes this token is missing.
 */
export function missingScopes(granted, required) {
  const held = new Set(granted);
  return required.filter((scope) => !held.has(scope));
}

/** One error shape for every failure this module reports to its caller. */
export class FeishuError extends Error {
  /**
   * @param {string} message - human readable, already actionable where possible.
   * @param {{ code?: number | string, hint?: string, status?: number }} [details] - API code plus a repair hint.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'FeishuError';
    this.code = details.code;
    this.hint = details.hint;
    this.status = details.status;
  }
}

/**
 * Feishu error codes worth translating: each one otherwise reads as an opaque
 * English sentence that does not say what the user should change.
 * @type {Record<string, string>}
 */
const ERROR_HINTS = {
  230002: '机器人不在这个群里：请把应用机器人拉进目标群后再试。',
  230006: '应用没有开启「机器人」能力：飞书开发者后台 → 应用能力 → 添加「机器人」并发布版本。',
  230013: '目标用户不在应用可用范围内：开发者后台 → 应用发布 → 版本管理与发布 → 可用范围。',
  230027: '权限不足：请检查开发者后台「权限管理」里是否已开通并发布本插件所需的权限。',
  230073: '该话题对当前身份不可见（群关闭了「新成员可查看历史消息」）。',
  231203: '群类型不支持获取消息（例如群开启了保密模式）。',
  231204: '该应用类型不支持以用户身份请求此接口。',
  232004: 'app_id 不存在：请检查设置里的 App ID。',
  232011: '当前身份不在这个群里：读群成员和历史消息需要操作者在群内。'
    + '插件的群列表是机器人所在的群，所以请确认应用机器人仍在群里（不在就把它拉回来）。',
  232025: '应用未启用机器人能力：开发者后台 → 应用能力 → 添加「机器人」。',
  232034: '应用在本租户下未安装或未启用：请先在管理后台安装/启用该应用。',
  99991679: '授权缺少这个接口需要的用户权限。需要在开发者后台「权限管理」里开通并发布对应权限，'
    + '然后回插件面板点「打开授权页」重新授权一次（旧 token 的权限不会自动增加）。',
  20005: 'app_id 或 app_secret 不正确。',
  20010: '当前用户没有该应用的使用权限（可用范围未包含该用户）。',
  20037: 'refresh_token 已过期，需要重新授权登录。',
  1470400: '请求参数错误（例如 page_size 非法）。',
};

/**
 * Translate one API error payload into an actionable message.
 * @param {{ code?: number, msg?: string }} payload - Feishu response body.
 * @returns {string} message, with a repair hint appended when one is known.
 */
export function describeApiError(payload) {
  const code = payload?.code;
  const msg = payload?.msg ?? 'unknown error';
  const hint = code !== undefined ? ERROR_HINTS[String(code)] : undefined;
  const head = code !== undefined ? `飞书接口错误 ${code}: ${msg}` : `飞书接口错误: ${msg}`;
  return hint === undefined ? head : `${head}\n${hint}`;
}

/**
 * Turn a non-2xx / non-zero-code response into a {@link FeishuError}.
 * @param {number} status - HTTP status.
 * @param {any} payload - parsed body, when it parsed.
 * @param {string} what - short description of the attempted operation.
 * @returns {FeishuError} the normalized error.
 */
export function apiError(status, payload, what) {
  const code = payload?.code;
  const hint = code !== undefined ? ERROR_HINTS[String(code)] : undefined;
  const body = payload === undefined ? '' : ` (HTTP ${status}: ${JSON.stringify(payload).slice(0, 300)})`;
  return new FeishuError(`${what} 失败 — ${payload?.msg ?? 'request failed'}${body}`, {
    code,
    hint,
    status,
  });
}

/**
 * Section of `$DSH_HOME/settings.yaml` this plugin owns.
 *
 * Named here rather than imported from the host half so this module stays a
 * standalone client that tests can load without the plugin entry.
 */
export const SETTINGS_DOC_SECTION = 'feishu-plugin';

/**
 * Throw when the plugin is used before app credentials are configured.
 *
 * The hint points at the settings document, not the Web settings page: that
 * page draws a card only for the namespaces it ships a card for, so a
 * third-party namespace registered on the Host has no form there.
 */
export function assertConfigured(config) {
  const hint = '填写飞书自建应用的 App ID 与 App Secret：运行 '
    + '`node scripts/apply-settings.mjs --app-id <App ID> --app-secret <App Secret>`，'
    + `或直接编辑 $DSH_HOME/settings.yaml 里的 ${SETTINGS_DOC_SECTION} 段（热加载，无需重启）。`;
  if (typeof config?.appId !== 'string' || config.appId.length === 0) {
    throw new FeishuError('尚未配置飞书 App ID', { hint });
  }
  if (typeof config?.appSecret !== 'string' || config.appSecret.length === 0) {
    throw new FeishuError('尚未配置飞书 App Secret', { hint });
  }
}

/**
 * Build a Feishu open-API URL.
 * @param {string} baseUrl - open-API origin (no trailing slash required).
 * @param {string} pathname - path beginning with `/open-apis/...`.
 * @param {Record<string, string | number | boolean | undefined>} [query] - query values; undefined entries are dropped.
 * @returns {string} absolute URL.
 */
export function buildUrl(baseUrl, pathname, query) {
  const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}
