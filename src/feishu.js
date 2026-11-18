import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeishuReads } from './upstream/reads.js';
import { renderMessageContent } from './upstream/content.js';

const messageId = /^om_[A-Za-z0-9_-]+$/;
const chatId = /^oc_[A-Za-z0-9_-]+$/;
const threadId = /^omt?_[A-Za-z0-9_-]+$/;
const meetingLink = /https:\/\/[a-z0-9-]+\.(?:larkenterprise\.com|feishu\.cn|larksuite\.com|larkoffice\.com)\/(docx|wiki|minutes)\/([A-Za-z0-9]+)/gi;
const meetingLabel = /meeting (?:notes|minutes)|transcript|\u4f1a\u8bae\u7eaa\u8981|\u667a\u80fd\u7eaa\u8981|\u6587\u5b57\u8bb0\u5f55|\u9010\u5b57\u7a3f|\u8bc4\u5ba1\u7eaa\u8981|\u4f1a\u8bae\u603b\u7ed3/i;
const unresolvedMedia = new Set(['file', 'image', 'audio', 'media', 'merge_forward', 'folder']);

export async function* pages(read) {
  let token;
  const seen = new Set();
  while (true) {
    const page = await read(token);
    yield* page.items;
    if (!page.hasMore) return;
    token = page.pageToken;
    if (!token || seen.has(token)) throw new Error('Feishu pagination did not advance');
    seen.add(token);
  }
}

export function discoverMeetingLinks(record) {
  if (record.deleted) return [];
  return [...record.text.matchAll(meetingLink)].flatMap(([url, kind, id], index, all) => {
    const start = all[index].index;
    const nearby = record.text.slice(Math.max(0, start - 30), start);
    const matches = kind === 'minutes' || meetingLabel.test(nearby)
      || (all.length === 1 && record.text.length < 700 && meetingLabel.test(record.text));
    return matches ? [{ id, kind, url, source: record.source, origin: record.id }] : [];
  });
}

function normalize(raw, group, brand, authors, thread) {
  if (!messageId.test(raw.message_id) || raw.chat_id !== group) {
    throw new Error('Invalid message ID or unexpected Feishu chat');
  }
  const sender = raw.sender;
  const msgType = raw.msg_type;
  const deleted = raw.deleted === true;
  const unattributed = msgType === 'system' || deleted;
  if (!unattributed && (!sender?.id || !sender.sender_type)) throw new Error('Feishu message is missing its sender');
  const numeric = Number(raw.create_time);
  const at = Number.isFinite(numeric) ? numeric : Date.parse(raw.create_time);
  if (!Number.isFinite(at) || at <= 0) throw new Error('Invalid Feishu message timestamp');
  const domain = brand === 'lark' ? 'larksuite.com' : 'feishu.cn';
  const topic = raw.thread_id ?? thread;
  const position = String(raw.message_position ?? '');
  const url = /^\d+$/.test(position)
    ? `https://applink.${domain}/client/chat/open?openChatId=${group}&position=${position}`
    : (typeof raw.message_app_link === 'string' ? raw.message_app_link : undefined);
  const senderId = sender?.id || (msgType === 'system' ? 'system' : 'deleted');
  return {
    id: raw.message_id, source: group, kind: 'message', at,
    author: sender?.name ?? authors.get(senderId) ?? senderId,
    sender: senderId,
    human: sender?.sender_type === 'user' && !sender.is_agent && msgType !== 'system',
    mentions: (raw.mentions ?? []).map(({ id, name }) => ({ id: id?.open_id ?? id, name })),
    deleted, thread: threadId.test(topic) ? topic : undefined, parent: raw.parent_id,
    text: deleted ? '' : typeof raw.body?.content === 'string'
      ? renderMessageContent(raw) : (raw.content ?? ''),
    url,
    unresolved: !deleted && unresolvedMedia.has(msgType) ? msgType : undefined,
  };
}

export function createFeishu(commands, brand) {
  const reads = createFeishuReads({
    async getJson(path, { query, prefer }) {
      if (prefer !== 'tenant') throw new Error('Work context requires the SuperAgent bot identity');
      const data = await commands.lark(['api', 'GET', path, '--params', JSON.stringify(query)]);
      return { data };
    },
  });
  return {
    async groups() {
      const groups = [];
      for await (const group of pages(reads.listChatPage)) {
        if (!chatId.test(group.chat_id) || typeof group.name !== 'string' || typeof group.chat_mode !== 'string') throw new Error('Invalid Feishu group');
        if (['group', 'topic', 'default'].includes(group.chat_mode.toLowerCase())) groups.push({ id: group.chat_id, name: group.name });
      }
      return groups;
    },
    async members(group) {
      const members = {};
      const read = async token => {
        const args = ['im', '+chat-members-list', '--chat-id', group, '--member-types', 'user', '--page-size', '100'];
        if (token) args.push('--page-token', token);
        const { users, has_more: hasMore, page_token: pageToken } = await commands.lark(args);
        if (!Array.isArray(users) || typeof hasMore !== 'boolean') throw new Error('Invalid Feishu chat member page');
        return { items: users, hasMore, pageToken };
      };
      for await (const { member_id: id, name } of pages(read)) {
        if (/^ou_[A-Za-z0-9]+$/.test(id) && typeof name === 'string') members[id] = name;
      }
      return members;
    },
    async *messages(group, startTime, endTime, authors) {
      for await (const raw of pages(pageToken => reads.listMessages({ chatId: group, startTime, endTime, pageToken }))) {
        yield normalize(raw, group, brand, authors);
      }
    },
    async *thread(group, thread, authors) {
      if (!threadId.test(thread)) throw new Error('Invalid Feishu thread ID');
      for await (const raw of pages(pageToken => reads.listMessages({ threadId: thread, pageToken }))) {
        yield normalize(raw, group, brand, authors, thread);
      }
    },
    async material(material) {
      const { kind, url, id, source, origin } = material;
      let text;
      let title;
      if (kind === 'minutes') {
        const data = await commands.lark(['minutes', '+detail', '--minute-tokens', id, '--summary', '--todo']);
        const item = data.minutes.find(value => value.minute_token === id) ?? data.minutes[0];
        if (!item || item.error) throw new Error(item?.error ?? 'Feishu Minutes response did not include the recording');
        if (!Object.values(item.artifacts).some(Boolean)) throw new Error('Feishu Minutes artifacts are unavailable');
        text = JSON.stringify(item.artifacts);
        title = item.title;
      } else {
        const { document } = await commands.lark(['docs', '+fetch', '--doc', url, '--doc-format', 'markdown']);
        text = document.content;
        title = document.title;
      }
      if (!text.trim()) throw new Error('Feishu meeting material is empty');
      return { id, source, kind: 'document', text, url, origin, title };
    },
    async transcript(material) {
      const dir = await mkdtemp(join(tmpdir(), 'superagent-minutes-'));
      try {
        const data = await commands.lark(['minutes', '+detail', '--minute-tokens', material.id, '--transcript', '--output-dir', dir]);
        const item = data.minutes[0];
        if (!item || item.error) throw new Error(item?.error ?? 'Feishu Minutes response did not include the recording');
        const names = await readdir(dir, { recursive: true, withFileTypes: true });
        const files = names.filter(entry => entry.isFile() && /\.(txt|md|srt|vtt|json)$/i.test(entry.name));
        const parts = await Promise.all(files.sort((a, b) => a.name.localeCompare(b.name))
          .map(entry => readFile(join(entry.parentPath, entry.name), 'utf8')));
        const text = parts.join('\n').trim();
        if (!text) throw new Error('Feishu Minutes transcript file is unavailable');
        return { id: `${material.id}:transcript`, source: material.source, kind: 'document', text,
          url: material.url, origin: material.origin, title: item.title };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async send(owner, text, key) {
      if (!/^ou_[A-Za-z0-9]+$/.test(owner)) throw new Error('A Feishu owner open ID is required');
      const data = await commands.lark(['im', '+messages-send', '--user-id', owner, '--text', text, '--idempotency-key', key]);
      const receipt = data.message_id ?? data.message?.message_id;
      if (!messageId.test(receipt)) throw new Error('Feishu send did not return a message ID');
      return receipt;
    },
  };
}
