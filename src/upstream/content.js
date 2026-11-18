/**
 * Pure projections: Feishu rows into the shapes this plugin reasons about.
 *
 * Nothing here performs I/O. Message content arrives as a JSON-encoded string
 * whose shape depends on `msg_type`, so these functions are the single place
 * that knows every shape, and every one of them degrades instead of throwing:
 * one exotic message must never break a whole summary or a whole chat view.
 *
 * @module dsh-feishu-plugin/feishu/content
 */

/**
 * Project one raw `task/v2/tasks` row.
 * @param {any} task - raw task.
 * @returns {{ id: string, title: string, description: string, due: number | undefined, dueAllDay: boolean, completed: boolean, tasklistNames: string[] }} normalized task.
 */
export function projectTask(task) {
  const rawDue = task?.due?.timestamp;
  const due = typeof rawDue === 'string' && rawDue.length > 0 ? Number(rawDue) : undefined;
  return {
    id: String(task?.guid ?? ''),
    title: typeof task?.summary === 'string' && task.summary.length > 0 ? task.summary : '(无标题任务)',
    description: typeof task?.description === 'string' ? task.description : '',
    due: due !== undefined && Number.isFinite(due) ? due : undefined,
    dueAllDay: task?.due?.is_all_day === true,
    completed: typeof task?.completed_at === 'string' && task.completed_at.length > 0 && task.completed_at !== '0',
    tasklistNames: Array.isArray(task?.tasklists)
      ? task.tasklists.map((entry) => entry?.tasklist_guid).filter((value) => typeof value === 'string')
      : [],
  };
}

/**
 * Project one raw chat row.
 * @param {any} chat - raw `im/v1/chats` row.
 * @returns {{ id: string, name: string, description: string, avatar: string | undefined, external: boolean }} normalized chat.
 */
export function projectChat(chat) {
  return {
    id: String(chat?.chat_id ?? ''),
    name: typeof chat?.name === 'string' && chat.name.length > 0 ? chat.name : '(未命名群)',
    description: typeof chat?.description === 'string' ? chat.description : '',
    avatar: typeof chat?.avatar === 'string' && chat.avatar.length > 0 ? chat.avatar : undefined,
    external: chat?.external === true,
  };
}

/** Placeholder text for message types that carry no promptable text. */
const MEDIA_PLACEHOLDERS = {
  image: '[图片]',
  file: '[文件]',
  audio: '[语音]',
  media: '[视频]',
  sticker: '[表情]',
  share_chat: '[群名片]',
  share_user: '[个人名片]',
  location: '[位置]',
  calendar: '[日程]',
  todo: '[任务]',
  vote: '[投票]',
  system: '[系统消息]',
};

/** Render model text back to a compact one-line body. */
function tidy(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * Walk a rich-text (`post`) message body, collecting text and link nodes.
 * @param {any} node - one node or array of nodes.
 * @param {string[]} out - accumulator.
 */
function collectPostNodes(node, out) {
  if (Array.isArray(node)) {
    for (const child of node) collectPostNodes(child, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (node.tag === 'text' && typeof node.text === 'string') out.push(node.text);
  else if (node.tag === 'a' && typeof node.text === 'string') out.push(node.href === undefined ? node.text : `${node.text}(${node.href})`);
  else if (node.tag === 'at') out.push(typeof node.user_name === 'string' && node.user_name.length > 0 ? `@${node.user_name}` : '@某人');
  else if (node.tag === 'img') out.push('[图片]');
  else if (node.tag === 'media') out.push('[视频]');
  else if (node.tag === 'emotion') out.push('[表情]');
  else if (node.tag === 'code_block' && typeof node.text === 'string') out.push(node.text);
  if (Array.isArray(node.content)) collectPostNodes(node.content, out);
}

/**
 * Walk a card (`interactive`) payload, collecting human-readable strings.
 *
 * Card payloads nest arbitrarily: a node's label may be the string itself
 * (`{ title: 'x' }`), a marked node (`{ text: { tag: 'plain_text', content: 'x' } }`),
 * or a list of blocks (`{ elements: [{ fields: [...] }] }`). The walker
 * therefore treats every object-valued key as walkable rather than naming a
 * fixed key set, so a shape nobody enumerated still contributes its text.
 * @param {any} node - card node.
 * @param {string[]} out - accumulator.
 */
function collectCardNodes(node, out) {
  if (Array.isArray(node)) {
    for (const child of node) collectCardNodes(child, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (typeof node.content === 'string' && node.content.length > 0) out.push(node.content);
  if (typeof node.text === 'string' && node.text.length > 0) out.push(node.text);
  if (typeof node.title === 'string' && node.title.length > 0) out.push(node.title);
  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') collectCardNodes(value, out);
  }
}

/**
 * Replace Feishu's `@_user_N` placeholders with the display name behind them.
 *
 * A text message carries the mention keys in its body and the names in the row's
 * separate `mentions` array, so the readable form only exists once the two are
 * joined. Both the prompt text and the chat view need this: `@_user_1` is noise
 * to a model and gibberish to a reader.
 *
 * @param {string} text - raw message text.
 * @param {Array<{ key?: string, name?: string }>} [mentions] - mention rows from the same message.
 * @returns {string} text with mention keys substituted.
 */
export function applyMentions(text, mentions) {
  let out = String(text ?? '');
  if (!Array.isArray(mentions)) return out;
  for (const mention of mentions) {
    const key = typeof mention?.key === 'string' ? mention.key : '';
    const name = typeof mention?.name === 'string' && mention.name.length > 0 ? mention.name : '';
    if (key.length === 0 || name.length === 0) continue;
    out = out.split(key).join(`@${name}`);
  }
  return out;
}

/**
 * Parse a message's JSON-encoded `body.content` without throwing.
 * @param {{ body?: { content?: string } }} message - raw message.
 * @returns {{ parsed: any, raw: string | undefined }} parsed payload (undefined when it is not JSON) and the raw string.
 */
function parseMessageContent(message) {
  const raw = message?.body?.content;
  if (typeof raw !== 'string' || raw.length === 0) return { parsed: undefined, raw: undefined };
  try {
    return { parsed: JSON.parse(raw), raw };
  } catch {
    return { parsed: undefined, raw };
  }
}

/**
 * Project a raw message into promptable text.
 *
 * Content arrives as a JSON-encoded string whose shape depends on `msg_type`,
 * so this is the one place that knows every shape. Unknown types degrade to a
 * bracketed placeholder rather than throwing, because one exotic message must
 * never break a whole summary.
 *
 * @param {{ msg_type?: string, body?: { content?: string }, deleted?: boolean, mentions?: any[] }} message - raw message.
 * @returns {string} promptable text ('' when nothing can be said about it).
 */
export function renderMessageContent(message) {
  if (message?.deleted === true) return '';
  const msgType = message?.msg_type ?? 'unknown';
  const { parsed, raw } = parseMessageContent(message);
  if (parsed === undefined && raw !== undefined) return applyMentions(tidy(raw), message?.mentions);
  let text;
  if (msgType === 'text') text = typeof parsed?.text === 'string' ? tidy(parsed.text) : '';
  else if (msgType === 'post') {
    const out = [];
    const body = parsed?.content ?? parsed;
    if (typeof parsed?.title === 'string' && parsed.title.length > 0) out.push(parsed.title);
    if (body !== null && typeof body === 'object') {
      for (const localeBody of Object.values(body)) collectPostNodes(localeBody, out);
    }
    text = tidy(out.join(' '));
  } else if (msgType === 'interactive' || msgType === 'card') {
    const out = [];
    collectCardNodes(parsed, out);
    const collected = tidy(out.join(' '));
    text = collected.length > 0 ? collected : '[卡片消息]';
  } else if (typeof parsed?.text === 'string') text = tidy(parsed.text);
  else if (typeof parsed?.content === 'string') text = tidy(parsed.content);
  else text = MEDIA_PLACEHOLDERS[msgType] ?? `[${msgType}消息]`;
  return applyMentions(text, message?.mentions);
}

/** Display kind for each `msg_type` the chat view knows how to draw. */
const MESSAGE_KINDS = {
  text: 'text',
  post: 'post',
  interactive: 'card',
  card: 'card',
  image: 'image',
  file: 'file',
  audio: 'audio',
  media: 'video',
  sticker: 'sticker',
};

/**
 * Split a `post` payload into its paragraphs, for a bubble that keeps the
 * author's line breaks instead of one run-on line.
 *
 * Only the first locale that has any text is used: the payload repeats the same
 * message once per language, and rendering all of them would duplicate it.
 *
 * @param {any} parsed - parsed post payload.
 * @returns {string[]} one string per paragraph.
 */
function postParagraphs(parsed) {
  const body = parsed?.content ?? parsed;
  if (body === null || typeof body !== 'object') return [];
  for (const localeBody of Object.values(body)) {
    const paragraphs = localeBody?.content;
    if (!Array.isArray(paragraphs)) continue;
    const lines = [];
    for (const paragraph of paragraphs) {
      const out = [];
      collectPostNodes(paragraph, out);
      const line = tidy(out.join(' '));
      if (line.length > 0) lines.push(line);
    }
    if (lines.length > 0) return lines;
  }
  return [];
}

/** The title of a card, across both documented envelopes. */
function cardTitle(parsed) {
  const fromHeader = parsed?.header?.title?.content;
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader;
  return typeof parsed?.title === 'string' && parsed.title.length > 0 ? parsed.title : undefined;
}

/**
 * The display-only half of a message: what kind of row to draw, and the keys a
 * chat renderer needs but the prompt text throws away.
 *
 * @param {string} msgType - `msg_type`.
 * @param {any} parsed - parsed `body.content`.
 * @returns {any} media description, or undefined when the kind needs none.
 */
function describeMedia(msgType, parsed) {
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const fileName = typeof parsed.file_name === 'string' && parsed.file_name.length > 0 ? parsed.file_name : undefined;
  if (msgType === 'image') {
    return typeof parsed.image_key === 'string' ? { imageKey: parsed.image_key } : undefined;
  }
  if (msgType === 'file') {
    return typeof parsed.file_key === 'string' ? { fileKey: parsed.file_key, fileName } : undefined;
  }
  if (msgType === 'audio' || msgType === 'media') {
    if (typeof parsed.file_key !== 'string') return undefined;
    const duration = Number(parsed.duration);
    return {
      fileKey: parsed.file_key,
      fileName,
      durationMs: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      coverImageKey: typeof parsed.image_key === 'string' ? parsed.image_key : undefined,
    };
  }
  if (msgType === 'post') {
    const title = typeof parsed.title === 'string' && parsed.title.length > 0 ? parsed.title : undefined;
    const lines = postParagraphs(parsed);
    return title === undefined && lines.length === 0 ? undefined : { title, lines };
  }
  if (msgType === 'interactive' || msgType === 'card') {
    const title = cardTitle(parsed);
    return title === undefined ? undefined : { title };
  }
  return undefined;
}

/**
 * The lines a bubble draws, in the author's own line breaks.
 *
 * `text` cannot carry them: it is whitespace-collapsed because it goes into a
 * prompt line. A chat view has room for the breaks, so they are kept separately
 * rather than recovered by guessing.
 *
 * @param {string} msgType - `msg_type`.
 * @param {any} parsed - parsed `body.content`.
 * @param {string} text - the projected prompt text.
 * @returns {string[]} lines to draw.
 */
function describeLines(msgType, parsed, text) {
  if (msgType === 'text' && typeof parsed?.text === 'string') {
    const lines = parsed.text.split('\n').map((line) => tidy(line)).filter((line) => line.length > 0);
    if (lines.length > 0) return lines;
  }
  if (msgType === 'post') {
    const lines = postParagraphs(parsed);
    if (lines.length > 0) return lines;
  }
  return text.length > 0 ? [text] : [];
}

/**
 * Describe one raw message for the chat view.
 *
 * `text` is exactly what {@link renderMessageContent} returns — one source of
 * truth, so a bubble and the summary prompt can never disagree about what a
 * message says — while `kind`, `lines` and `media` carry the structure a bubble
 * needs (line breaks, an image key, a file name, a duration) that the flattened
 * text drops.
 *
 * @param {any} message - raw message.
 * @returns {{ kind: string, text: string, lines: string[], media: any }} display description.
 */
export function describeMessage(message) {
  // A recalled message keeps its row so the view can show the system line; it
  // contributes no text, which is also why it must not reach the prompt.
  if (message?.deleted === true) return { kind: 'recalled', text: '', lines: [], media: undefined };
  const msgType = message?.msg_type ?? 'unknown';
  const { parsed } = parseMessageContent(message);
  const text = renderMessageContent(message);
  return {
    kind: MESSAGE_KINDS[msgType] ?? 'other',
    text,
    // The mention keys live in the raw paragraph text, and the bubble draws
    // these lines rather than `text` — so the substitution has to happen here
    // too, or the bubble would show `@_user_1` while the prompt showed `@张三`.
    lines: describeLines(msgType, parsed, text).map((line) => applyMentions(line, message?.mentions)),
    media: describeMedia(msgType, parsed),
  };
}

/**
 * Project the `mentions` rows into the pair the view substitutes.
 * @param {any[]} [mentions] - raw mention rows.
 * @returns {Array<{ key: string, name: string }>} usable mentions.
 */
function projectMentions(mentions) {
  if (!Array.isArray(mentions)) return [];
  const out = [];
  for (const mention of mentions) {
    const key = typeof mention?.key === 'string' ? mention.key : '';
    const name = typeof mention?.name === 'string' ? mention.name : '';
    if (key.length > 0 && name.length > 0) out.push({ key, name });
  }
  return out;
}

/**
 * Project one raw message plus a sender-name resolver into a display row.
 *
 * @param {any} message - raw message.
 * @param {(id: string) => string} resolveSender - sender id → display name.
 * @returns {any | undefined} the row, or `undefined` for a message with neither text nor a row of its own.
 */
export function projectMessage(message, resolveSender) {
  const described = describeMessage(message);
  if (described.text.length === 0 && described.kind !== 'recalled') return undefined;
  const senderId = String(message?.sender?.id ?? '');
  const senderType = String(message?.sender?.sender_type ?? 'user');
  const createdAt = Number(message?.create_time ?? 0);
  return {
    id: String(message?.message_id ?? ''),
    senderId,
    senderName: resolveSender(senderId),
    senderType,
    at: Number.isFinite(createdAt) ? createdAt : 0,
    text: described.text,
    kind: described.kind,
    lines: described.lines,
    media: described.media,
    mentions: projectMentions(message?.mentions),
    parentId: typeof message?.parent_id === 'string' && message.parent_id.length > 0 ? message.parent_id : undefined,
    rootId: typeof message?.root_id === 'string' && message.root_id.length > 0 ? message.root_id : undefined,
    threadId: typeof message?.thread_id === 'string' && message.thread_id.length > 0 ? message.thread_id : undefined,
    deleted: message?.deleted === true,
    updated: message?.updated === true,
  };
}

/**
 * Render projected messages into one prompt transcript, oldest first.
 *
 * Rows with no text (a recalled message, a system line) are skipped rather than
 * rendered as an empty speaker turn: they add nothing a model can use, and they
 * would otherwise spend characters out of the budget.
 *
 * @param {Array<{ at: number, senderName: string, text: string }>} messages - projected messages.
 * @param {{ maxChars?: number }} [options] - character budget.
 * @returns {{ transcript: string, truncated: boolean, included: number }} prompt body.
 */
export function renderTranscript(messages, options = {}) {
  const maxChars = options.maxChars ?? 60000;
  const lines = [];
  let used = 0;
  let truncated = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message.text !== 'string' || message.text.length === 0) continue;
    const stamp = message.at > 0 ? new Date(message.at).toISOString().slice(0, 16).replace('T', ' ') : '未知时间';
    // An unresolved sender is labelled as unknown rather than dropped: a model
    // reading the transcript must not be told a name that was never resolved.
    const speaker = typeof message.senderName === 'string' && message.senderName.length > 0
      ? message.senderName
      : '未知成员';
    const line = `[${stamp}] ${speaker}: ${message.text}`;
    if (used + line.length > maxChars) {
      truncated = true;
      break;
    }
    used += line.length + 1;
    lines.unshift(line);
  }
  return { transcript: lines.join('\n'), truncated, included: lines.length };
}

