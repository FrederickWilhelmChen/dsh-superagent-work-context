/**
 * dsh-feishu-plugin — host half.
 *
 * The Node side of the plugin owns everything that must not live in a browser:
 * the Feishu app credentials, both access tokens, every outbound Feishu request,
 * and the DeepSeek summarization call. It exposes that as a small same-origin
 * JSON API under `/plugin/feishu`, which the browser half calls with `fetch`.
 *
 * Why an HTTP route instead of the Typert Remote wire: a Remote namespace is a
 * build-time-generated, declaration-merged projection, and the shipped browser
 * assembly (`@deepseek-ai/dsh-api-remotes`) mounts a hard-coded list of
 * namespaces — a third-party package cannot add one. The webserver's named
 * route table, by contrast, is explicitly the place "feature plugins claim
 * their routes" (`dsh-host-webserver/README.md`), and the browser already talks
 * to the same origin for `/api` and `/plugins`.
 *
 * This module is the entry point and nothing else: it owns the plugin's
 * lifetime and cache, and hands them to the pieces that do the work —
 * {@link ./plugin/support.mjs} (schema and shared helpers),
 * {@link ./plugin/reads.mjs} (cached reads), {@link ./plugin/routes.mjs}
 * (the HTTP surface), {@link ./plugin/tools.mjs} (model-facing tools).
 *
 * @module dsh-feishu-plugin
 */

import { DEFAULT_MODEL, DEFAULT_PROVIDER } from './summary.mjs';
import { createFeishuClient, FeishuError, assertConfigured } from './feishu.mjs';
import { createReads } from './plugin/reads.mjs';
import { createRoutes } from './plugin/routes.mjs';
import { registerTools } from './plugin/tools.mjs';
import { API_PREFIX, Config, SETTINGS_NAMESPACE, toErrorPayload } from './plugin/support.mjs';

export * from './plugin/support.mjs';

/**
 * Host-side plugin body.
 *
 * @param {any} ctx - the plugin context (webServer + settings are guaranteed by `inject`).
 * @param {any} entryConfig - the row's config, used as the settings base layer.
 */
export function apply(ctx, entryConfig = {}) {
  const logger = ctx.logger('feishu-plugin');
  /** Resolved configuration; replaced by the settings scope once it attaches. */
  let current = () => entryConfig;
  /** In-memory read cache; deliberately not persisted (it is a view, not data). */
  const cache = {
    tasks: /** @type {any[] | undefined} */ (undefined),
    tasksAt: 0,
    tasksSource: /** @type {'my_tasks' | 'tasklists' | undefined} */ (undefined),
    tasksNotice: /** @type {string | undefined} */ (undefined),
    chats: /** @type {any[] | undefined} */ (undefined),
    chatsAt: 0,
    /** Last conversation pulled per chat id, so the panel need not refetch. */
    transcripts: /** @type {Map<string, any>} */ (new Map()),
    /** Chat member id → name, per chat id. Names change rarely; the TTL is short anyway. */
    members: /** @type {Map<string, { at: number, names: Map<string, string>, lookup: any }>} */ (new Map()),
  };

  const client = createFeishuClient({
    getConfig: () => ({ ...entryConfig, ...current() }),
    warn: (message, detail) => logger.warn(message, detail),
  });

  /**
   * The config accessor handed to the modules below.
   *
   * `current` is a *binding* that the settings source replaces once the provider
   * attaches; passing it by value would freeze each module on the composition
   * entry, and settings would never be seen — which is exactly how every read
   * kept reporting "not configured" after this file was split up. This wrapper
   * has a stable identity and always reads whatever `current` points at now.
   */
  const liveConfig = () => current();

  // ── settings wiring ───────────────────────────────────────────────────────
  // Mutating `current` (rather than recreating the client) keeps a settings
  // change live without a restart; the token cache is dropped explicitly
  // because credentials are part of its key.
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, Config, entryConfig, {
        setSource: (source) => {
          current = source;
          client.resetToken();
        },
        onChange: () => {
          client.resetToken();
          cache.tasks = undefined;
          cache.chats = undefined;
          cache.transcripts.clear();
          cache.members.clear();
        },
      });
    } catch (error) {
      logger.warn('settings section registration failed', toErrorPayload(error).message);
    }
  });

  /** Write a partial config patch back to the settings document. */
  async function patchSettings(patch) {
    const settings = ctx.get('settings');
    if (settings === undefined || typeof settings.update !== 'function') {
      throw new FeishuError('当前组合没有可写的设置服务，无法保存登录状态', {
        hint: '登录信息需要写入 ~/.dsh/settings.yaml；请确认 settings 插件已启用。',
      });
    }
    await settings.update(SETTINGS_NAMESPACE, patch);
    client.resetToken();
  }

  /** Resolve the model selection for summarization. */
  function resolveSelection() {
    const config = current();
    const fromSettings = {
      ...config.summaryProvider === undefined || config.summaryProvider === '' ? {} : { provider: config.summaryProvider },
      ...config.summaryModel === undefined || config.summaryModel === '' ? {} : { model: config.summaryModel },
    };
    if (fromSettings.provider !== undefined && fromSettings.model !== undefined) return fromSettings;
    let sessionDefault;
    try {
      sessionDefault = ctx.get('agentDefaultModel')?.currentSelection();
    } catch (error) {
      logger.debug('default model lookup failed', toErrorPayload(error).message);
    }
    return {
      provider: fromSettings.provider ?? sessionDefault?.provider ?? DEFAULT_PROVIDER,
      model: fromSettings.model ?? sessionDefault?.model ?? DEFAULT_MODEL,
    };
  }

  const reads = createReads({ client, cache, current: liveConfig, logger, patchSettings });
  const routes = createRoutes({
    ctx,
    logger,
    client,
    cache,
    current: liveConfig,
    patchSettings,
    ensureUserToken: reads.ensureUserToken,
    readTasks: reads.readTasks,
    readChats: reads.readChats,
    readTranscript: reads.readTranscript,
    resolveSelection,
  });

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: routes.handleRequest,
  }), 'feishu-plugin: api routes');

  registerTools({ ctx, logger, current: liveConfig, readTranscript: reads.readTranscript, resolveSelection });

  logger.info(`feishu plugin api mounted at ${API_PREFIX}`);
}
