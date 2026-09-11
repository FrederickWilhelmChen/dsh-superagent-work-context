/**
 * Reads with their cache: tasks, chats, chat member names, and transcripts.
 *
 * The Feishu client is stateless per call; everything that remembers an answer
 * (and everything that decides when a remembered answer is still good) lives
 * here. The caches are deliberately in-memory: they are a view of Feishu, not
 * data of their own, so a restart simply re-reads.
 *
 * @module dsh-feishu-plugin/plugin/reads
 */

import {
  FeishuError,
  assertConfigured,
  projectChat,
  projectMessage,
  projectTask,
  renderTranscript,
} from '../feishu.mjs';
import {
  DEFAULT_CHAT_LIMIT,
  DEFAULT_MESSAGE_LIMIT,
  DEFAULT_TASK_LIMIT,
  planTaskRead,
  toErrorPayload,
} from './support.mjs';

/**
 * Build the read face over one plugin's cache and client.
 *
 * @param {object} deps - read dependencies.
 * @param {any} deps.client - Feishu client.
 * @param {any} deps.cache - the plugin's in-memory cache.
 * @param {() => any} deps.current - live plugin config.
 * @param {any} deps.logger - plugin logger.
 * @param {(patch: any) => Promise<void>} deps.patchSettings - settings writer, for token rotation.
 * @returns {object} the read face.
 */
export function createReads({ client, cache, current, logger, patchSettings }) {
  /**
   * Refresh the user access token from the stored refresh token.
   * @returns {Promise<boolean>} whether a usable token is now in place.
   */
  async function ensureUserToken() {
    const config = current();
    if (typeof config.userToken === 'string' && config.userToken.length > 0
      && typeof config.userTokenExpiresAt === 'number' && config.userTokenExpiresAt > Date.now() + 60000) {
      return true;
    }
    if (typeof config.refreshToken !== 'string' || config.refreshToken.length === 0) return false;
    try {
      const refreshed = await client.refreshUserToken({ refreshToken: config.refreshToken });
      await patchSettings({
        userToken: refreshed.accessToken,
        ...refreshed.refreshToken === undefined ? {} : { refreshToken: refreshed.refreshToken },
        userTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
      });
      logger.info('user_access_token refreshed');
      return true;
    } catch (error) {
      logger.warn('user_access_token refresh failed', toErrorPayload(error).message);
      // A dead refresh token must not be retried on every poll.
      await patchSettings({ userToken: '', refreshToken: '', userTokenExpiresAt: 0 }).catch(() => {});
      return false;
    }
  }

  /**
   * Read tasks, preferring the user's own list and falling back to task lists.
   * @param {{ force?: boolean }} [options] - `force` bypasses the read cache.
   * @returns {Promise<{ items: any[], source: string | undefined, notice?: string, error?: string, truncated: boolean }>} tasks plus provenance, and the reason when the read failed.
   */
  async function readTasks(options = {}) {
    // `planTaskRead` owns the cache decision, including the rule that a cached
    // empty list is not an answer worth serving: it is either a cold cache or a
    // read that failed and was recorded as empty. Requiring a source makes a
    // failed read retry, which is what lets a transient failure heal instead of
    // sticking for the whole TTL.
    const decision = options.force === true ? 'read' : planTaskRead(cache, Date.now());
    if (decision === 'cache') {
      return {
        items: cache.tasks,
        source: cache.tasksSource,
        ...cache.tasksNotice === undefined ? {} : { notice: cache.tasksNotice },
        ...cache.tasksError === undefined ? {} : { error: cache.tasksError },
        truncated: false,
      };
    }
    if (decision === 'remember') {
      return {
        items: cache.tasks ?? [],
        source: cache.tasksSource,
        ...cache.tasksNotice === undefined ? {} : { notice: cache.tasksNotice },
        error: cache.tasksError,
        truncated: false,
      };
    }
    assertConfigured(current());
    /** @type {string | undefined} */
    let notice;
    /** @type {string | undefined} */
    let primaryError;
    if (await ensureUserToken()) {
      try {
        const result = await client.listMyTasks({ limit: DEFAULT_TASK_LIMIT, completed: false });
        const items = result.items.map(projectTask);
        cache.tasks = items;
        cache.tasksSource = 'my_tasks';
        cache.tasksNotice = undefined;
        cache.tasksError = undefined;
        cache.tasksErrorAt = undefined;
        cache.tasksAt = Date.now();
        return { items, source: 'my_tasks', truncated: result.truncated };
      } catch (error) {
        primaryError = `读取「我负责的」任务失败：${toErrorPayload(error).message}`;
        notice = `${primaryError}已回退到任务清单。`;
        logger.warn('my_tasks read failed; falling back to task lists', toErrorPayload(error).message);
      }
    } else {
      notice = '尚未登录飞书，当前显示的是应用可读的任务清单；点「登录飞书」后可读取「我负责的」任务。';
    }
    const lists = await client.listTasklists({ limit: 20 });
    /** @type {any[]} */
    const items = [];
    for (const list of lists.items) {
      const guid = typeof list?.guid === 'string' ? list.guid : undefined;
      if (guid === undefined) continue;
      try {
        const tasks = await client.listTasklistTasks({ tasklistGuid: guid, limit: DEFAULT_TASK_LIMIT, completed: false });
        for (const task of tasks.items) {
          items.push({ ...projectTask(task), tasklistGuid: guid, tasklistName: typeof list.name === 'string' ? list.name : '' });
        }
      } catch (error) {
        logger.warn(`tasklist ${guid} read failed`, toErrorPayload(error).message);
      }
    }
    // Empty here has several very different meanings, and conflating them is
    // what let a failed read look like "you have no tasks": the fallback may
    // genuinely hold none, may be unreadable itself, or may be an empty
    // accident standing in for a primary source that failed. Every one of those
    // except a real empty read is an error the panel must show.
    const fallbackUnreadable = lists.tasklistsUnreadable === true;
    const error = primaryError !== undefined
      ? primaryError
      : fallbackUnreadable
        ? `读取任务清单失败（${lists.tasklistsError ?? '原因未知'}）`
        : undefined;
    const fallback = {
      items,
      source: 'tasklists',
      ...notice === undefined ? {} : { notice },
      ...error === undefined ? {} : { error },
      truncated: lists.truncated,
    };
    if (error !== undefined) {
      // A failure must not be cached: stamping the clock here would make a
      // transient error the answer for the whole TTL, which is exactly how the
      // panel came to insist the user had no open tasks.
      return fallback;
    }
    cache.tasks = items;
    cache.tasksSource = 'tasklists';
    cache.tasksNotice = notice;
    cache.tasksError = undefined;
    cache.tasksErrorAt = undefined;
    cache.tasksAt = Date.now();
    return fallback;
  }

  /**
   * List the chats the bot is in.
   * @param {{ force?: boolean }} [options] - `force` bypasses the read cache.
   * @returns {Promise<any[]>} normalized chats.
   */
  async function readChats(options = {}) {
    if (options.force !== true && cache.chats !== undefined && Date.now() - cache.chatsAt < 120_000) return cache.chats;
    assertConfigured(current());
    const result = await client.listChats({ limit: DEFAULT_CHAT_LIMIT });
    const chats = result.items.map(projectChat).filter((chat) => chat.id.length > 0);
    cache.chats = chats;
    cache.chatsAt = Date.now();
    return chats;
  }

  /**
   * Read a chat's member names, cached per chat.
   *
   * Names are the difference between a chat view and a list of opaque ids, but
   * they are also the one part of a transcript that can fail on its own (the
   * member endpoint refuses an operator who is not in the group). Caching them
   * keeps that cost off every refresh, and a failure is returned rather than
   * thrown so the messages still render.
   *
   * @param {string} chatId - chat identity.
   * @returns {Promise<{ names: Map<string, string>, lookup: { ok: boolean, count: number, truncated: boolean, error?: string } }>} the lookup and its outcome.
   */
  async function readMemberNames(chatId) {
    const ttlMs = 10 * 60_000;
    const cached = cache.members.get(chatId);
    if (cached !== undefined && Date.now() - cached.at < ttlMs) {
      return { names: cached.names, lookup: cached.lookup };
    }
    const result = await client.listChatMembers({ chatId });
    const names = new Map(result.items.map((member) => [member.id, member.name]));
    const lookup = result.unreadable === true
      ? { ok: false, count: 0, truncated: false, error: result.error ?? '读取群成员失败' }
      : { ok: true, count: names.size, truncated: result.truncated === true };
    // A failed lookup is cached too, but only briefly: retrying it on every
    // refresh would multiply one permission problem into a stream of requests.
    cache.members.set(chatId, { at: Date.now(), names, lookup });
    return { names, lookup };
  }

  /**
   * Pull a chat's recent messages and project them for both the prompt and the
   * chat view.
   * @param {{ chatId: string, limit?: number, hours?: number }} options - request options.
   * @returns {Promise<any>} transcript bundle.
   */
  async function readTranscript(options) {
    assertConfigured(current());
    const config = current();
    const chatId = String(options.chatId ?? '');
    if (chatId.length === 0) throw new FeishuError('缺少 chatId');
    const limit = Math.min(2000, Math.max(10, Number(options.limit ?? config.maxMessages ?? DEFAULT_MESSAGE_LIMIT)));
    const endTime = Date.now();
    const startTime = typeof options.hours === 'number' && options.hours > 0 ? endTime - options.hours * 3600_000 : undefined;
    const raw = await client.listRecentMessages({ chatId, limit, startTime, endTime });
    const { names, lookup } = await readMemberNames(chatId);
    const selfName = typeof config.userName === 'string' ? config.userName : '';
    const messages = [];
    for (const message of raw.items) {
      const senderId = String(message?.sender?.id ?? '');
      const mentionName = Array.isArray(message?.mentions)
        ? message.mentions.find((mention) => mention?.id === senderId && typeof mention.name === 'string')?.name
        : undefined;
      // Resolution order matters: the member list is the only source of real
      // names and a mention carries one for free. Anything else stays *unmarked*
      // as a person: `unresolved` is what the panel keys off, which is why the
      // id-shaped placeholder below never reaches a bubble. It does reach the
      // prompt, because a model needs some handle to tell two speakers apart.
      const resolved = names.get(senderId)
        ?? (typeof mentionName === 'string' && mentionName.length > 0 ? mentionName : undefined);
      const unresolved = typeof resolved !== 'string' || resolved.length === 0;
      const senderLabel = unresolved ? `${senderId.slice(0, 8)}…` : resolved;
      const projected = projectMessage(message, () => senderLabel);
      if (projected !== undefined) {
        projected.unresolved = unresolved;
        messages.push(projected);
      }
    }
    const rendered = renderTranscript(messages, { maxChars: 60000 });
    const chat = (cache.chats ?? []).find((entry) => entry.id === chatId);
    const bundle = {
      chatId,
      chatName: chat?.name ?? chatId,
      chat: chat === undefined ? undefined : { id: chat.id, name: chat.name, avatar: chat.avatar, description: chat.description },
      self: {
        id: typeof config.userId === 'string' ? config.userId : '',
        name: selfName,
        avatar: typeof config.userAvatar === 'string' && config.userAvatar.length > 0 ? config.userAvatar : undefined,
      },
      messages,
      messageCount: messages.length,
      // Rows with no text (recalled messages) still count as messages but must
      // not count as summarizable content.
      textCount: messages.filter((message) => message.text.length > 0).length,
      memberLookup: lookup,
      rangeStart: startTime ?? (messages.length > 0 ? messages[0].at : undefined),
      rangeEnd: endTime,
      truncated: raw.truncated || rendered.truncated,
      transcript: rendered.transcript,
      fetchedAt: Date.now(),
    };
    cache.transcripts.set(chatId, bundle);
    return bundle;
  }

  return { ensureUserToken, readTasks, readChats, readMemberNames, readTranscript };
}
