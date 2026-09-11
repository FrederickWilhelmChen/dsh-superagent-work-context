/**
 * 飞书 (Feishu / Lark) open-API client used by the DSH feishu plugin.
 *
 * Two credential planes are supported, because the two halves of this plugin
 * need different ones:
 *
 * - `tenant_access_token` — the bot's own token, obtained from the app id and
 *   secret with no user interaction. It can list the chats the bot is in, read
 *   those chats' history and member names, and read task lists shared with the
 *   app.
 * - `user_access_token` — the authorizing person's token. It is the only token
 *   `task/v2/tasks?type=my_tasks` accepts, so "我负责的" tasks need it.
 *
 * The implementation is split by responsibility; this module is the facade the
 * rest of the plugin and its tests import, so the split stays internal:
 *
 * - {@link ./feishu/common.mjs} — origins, scopes, error types and hints.
 * - {@link ./feishu/transport.mjs} — credential cache and request helpers.
 * - {@link ./feishu/content.mjs} — pure projections of tasks, chats, messages.
 * - {@link ./feishu/api.mjs} — one function per open-API capability.
 *
 * @module dsh-feishu-plugin/feishu
 */

export * from './feishu/common.mjs';
export * from './feishu/content.mjs';
export * from './feishu/api.mjs';
