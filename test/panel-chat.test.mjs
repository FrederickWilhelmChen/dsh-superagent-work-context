/**
 * Cases for the chat view: what a message looks like on screen.
 *
 * The host also renders the same messages into a prompt transcript, but that is
 * a different job with a different shape — these cases are about what a person
 * reads, so they assert on bubbles, grouping, day separators, quotes, and the
 * media route the images come from.
 *
 * @module dsh-feishu-plugin/test/panel-chat
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import {
  allNodes,
  findNode,
  flattenWithHooks,
  loadBundle,
  messageRow,
  propsFor,
} from './panel-harness.mjs';

const { test, cases } = suite('panel.chat');

test('the chat view groups a speaker\'s run, marks days, and mirrors the user\'s own messages', () => {
  const bundle = loadBundle();
  const self = { id: 'ou_me', name: '我的名字', avatar: undefined };
  const face = { insert: () => {}, inserted: null, available: true, hint: '' };
  const messages = [
    messageRow({ id: 'om_1', at: Date.UTC(2026, 8, 10, 6, 0), text: '昨天的第一句', lines: ['昨天的第一句'] }),
    messageRow({ id: 'om_2', at: Date.UTC(2026, 8, 11, 6, 0), text: '今天第一句', lines: ['今天第一句'] }),
    messageRow({ id: 'om_3', at: Date.UTC(2026, 8, 11, 6, 1), text: '同一人接着说', lines: ['同一人接着说'] }),
    messageRow({ id: 'om_4', at: Date.UTC(2026, 8, 11, 6, 2), senderId: 'ou_me', senderName: '我的名字', text: '我说的', lines: ['我说的'] }),
    messageRow({ id: 'om_5', at: Date.UTC(2026, 8, 11, 6, 3), senderId: 'ou_li', senderName: '李四', text: '李四说的', lines: ['李四说的'] }),
  ];
  const tree = flattenWithHooks(
    bundle.hooks.render(bundle.components.get('MessageList'), { bundle: { messages, fetchedAt: 1 }, self, t: (key) => key, face }),
    bundle.hooks.render,
  );

  const rows = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msg');
  assert.equal(rows.length, 5, 'every message becomes a row');
  assert.equal(rows.filter((row) => row.props['data-self'] === 'true').length, 1, 'exactly the own message is marked as mine');

  // Two day separators: one per calendar day, not one per message.
  const separators = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-daySep');
  assert.equal(separators.length, 2, 'a separator appears once per day');

  // Headers appear once per run: 张三 says nothing for a day, so the next
  // morning's message starts a new run of its own (a group never spans
  // midnight), the user's own row is labelled from the dictionary rather than
  // with the raw name, and 李四 starts a third run.
  const senders = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msgSender');
  assert.deepEqual(senders.map((node) => node.children.join('')), ['张三', '张三', 'msg.me', '李四']);

  // Times only ride the first bubble of a group.
  const times = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msgTime');
  assert.equal(times.length, 4, 'a grouped continuation has no header of its own');
});

test('a bubble keeps mentions, links, quotes and images in their own shapes', () => {
  const bundle = loadBundle();
  const face = { insert: () => {}, inserted: null, available: true, hint: '' };
  const messages = [
    messageRow({
      id: 'om_1',
      text: '@李四 看下 https://example.com/doc 这个',
      lines: ['@李四 看下 https://example.com/doc 这个'],
      mentions: [{ key: '@_user_9', name: '李四' }],
    }),
    messageRow({ id: 'om_2', senderId: 'ou_li', senderName: '李四', text: '好的', lines: ['好的'], parentId: 'om_1' }),
    messageRow({ id: 'om_3', senderId: 'ou_li', senderName: '李四', kind: 'image', text: '[图片]', lines: ['[图片]'], media: { imageKey: 'img_v2_x' } }),
    messageRow({ id: 'om_4', senderId: 'ou_li', senderName: '李四', text: '很长的内容', lines: ['很长的内容'], parentId: 'om_absent' }),
  ];
  const tree = flattenWithHooks(
    bundle.hooks.render(bundle.components.get('MessageList'), { bundle: { messages, fetchedAt: 1 }, self: { id: '', name: '', avatar: undefined }, t: (key) => key, face }),
    bundle.hooks.render,
  );

  const mention = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-mention');
  assert.deepEqual(mention.map((node) => node.children.join('')), ['@李四'], 'a mention is highlighted, not plain text');
  // Only the mentioned name lights up: the URL stays a link and the rest stays text.
  const links = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-link');
  assert.deepEqual(links.map((node) => node.props.href), ['https://example.com/doc']);

  const quote = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-quote');
  assert.equal(quote.length, 1, 'a reply shows its parent when the parent is in the window');
  assert.deepEqual(
    allNodes(quote[0], (node) => String(node.props?.className ?? '') === 'dsh-feishu-quoteWho').map((node) => node.children.join('')),
    ['张三'],
  );
  const missing = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-quoteMissing');
  assert.equal(missing.length, 1, 'a reply to something outside the window says so');

  const image = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-mediaImage');
  assert.equal(image.length, 1);
  assert.ok(String(image[0].props.src).startsWith('/plugin/feishu/api/media?'), String(image[0].props.src));
  assert.ok(String(image[0].props.src).includes('messageId=om_3'), String(image[0].props.src));
  assert.ok(String(image[0].props.src).includes('fileKey=img_v2_x'), String(image[0].props.src));
  assert.ok(String(image[0].props.src).includes('type=image'), String(image[0].props.src));
});

test('a recalled message is a system line, and a file is a card', () => {
  const bundle = loadBundle();
  const face = { insert: () => {}, inserted: null, available: true, hint: '' };
  const messages = [
    messageRow({ id: 'om_1', kind: 'recalled', text: '', lines: [], deleted: true }),
    messageRow({
      id: 'om_2',
      senderId: 'ou_li',
      senderName: '李四',
      kind: 'file',
      text: '[文件]',
      lines: ['[文件]'],
      media: { fileKey: 'file_1', fileName: '周报.pdf' },
    }),
    messageRow({
      id: 'om_3',
      senderId: 'ou_li',
      senderName: '李四',
      kind: 'audio',
      text: '[语音]',
      lines: ['[语音]'],
      media: { fileKey: 'file_a', fileName: undefined, durationMs: 125_000 },
    }),
  ];
  const tree = flattenWithHooks(
    bundle.hooks.render(bundle.components.get('MessageList'), { bundle: { messages, fetchedAt: 1 }, self: { id: '', name: '', avatar: undefined }, t: (key) => key, face }),
    bundle.hooks.render,
  );

  const recalled = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-recalled');
  assert.equal(recalled.length, 1);
  assert.ok(recalled[0].children.join('').includes('msg.recalled'), recalled[0].children);
  assert.equal(allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-bubble').length, 2, 'a recalled row is not a bubble');

  const name = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-fileName');
  assert.deepEqual(name.map((node) => node.children.join('')), ['周报.pdf', '[语音]'], 'a nameless audio falls back to its placeholder text');
  const meta = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-fileMeta');
  assert.deepEqual(meta.map((node) => node.children.join('')), ['2:05'], 'a duration is rendered as minutes and seconds');
  const audio = allNodes(tree, (node) => node.type === 'audio');
  assert.equal(audio.length, 1);
  assert.ok(String(audio[0].props.src).includes('type=file'), String(audio[0].props.src));
  assert.equal(audio[0].props.controls, true);
});

test('the thread says what it is showing, and what it could not', () => {
  const bundle = loadBundle();
  const face = { insert: () => {}, inserted: null, available: true, hint: '' };
  const thread = bundle.components.get('ChatThread');
  assert.ok(thread !== undefined, 'the bundle must declare ChatThread');

  const empty = bundle.hooks.render(thread, { transcript: null, selected: undefined, t: (key) => key, face, self: {}, busy: false });
  assert.equal(findNode(empty, (node) => String(node.props?.className ?? '') === 'dsh-feishu-empty').children.join(''), 'empty.thread');

  const messages = [messageRow({ id: 'om_1' })];
  const loaded = flattenWithHooks(bundle.hooks.render(thread, {
    transcript: { chatName: '群一', chat: { id: 'oc_1', name: 'DragonBowl 工作组' }, messages, truncated: true, memberLookup: { ok: true, count: 2, truncated: false }, fetchedAt: 1 },
    selected: undefined,
    t: (key) => key,
    face,
    self: { id: '', name: '', avatar: undefined },
    busy: false,
  }), bundle.hooks.render);
  const name = allNodes(loaded, (node) => String(node.props?.className ?? '') === 'dsh-feishu-threadName');
  assert.deepEqual(name.map((node) => node.children.join('')), ['DragonBowl 工作组']);
  const meta = allNodes(loaded, (node) => String(node.props?.className ?? '') === 'dsh-feishu-kv').map((node) => node.children.join(''));
  assert.ok(meta.some((text) => text.includes('label.truncated')), `a partial read must say so: ${JSON.stringify(meta)}`);

  const unreadable = flattenWithHooks(bundle.hooks.render(thread, {
    transcript: { chatName: '群一', messages, truncated: false, memberLookup: { ok: false, count: 0, truncated: false, error: '飞书接口错误 232011' }, fetchedAt: 1 },
    selected: undefined,
    t: (key) => key,
    face,
    self: { id: '', name: '', avatar: undefined },
    busy: false,
  }), bundle.hooks.render);
  const notes = allNodes(unreadable, (node) => String(node.props?.className ?? '') === 'dsh-feishu-note');
  assert.equal(notes.length, 1, 'a name failure is stated once, in the open');
  // The text must be the note's own child, not an array nested one level deep:
  // such a note renders empty in a renderer that reads `children` literally.
  assert.ok(notes[0].children.join(' ').includes('232011'), notes[0].children);
  assert.ok(notes[0].children.every((child) => typeof child !== 'object' || Array.isArray(child) === false), `a note holds flat children: ${JSON.stringify(notes[0].children)}`);
  assert.equal(allNodes(unreadable, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msg').length, 1, 'the messages survive it');
});

test('an empty range says so, and a capped list admits the cap', () => {
  const bundle = loadBundle();
  const face = { insert: () => {}, inserted: null, available: true, hint: '' };
  const list = bundle.components.get('MessageList');

  const empty = bundle.hooks.render(list, { bundle: { messages: [], fetchedAt: 1 }, self: {}, t: (key) => key, face });
  assert.equal(findNode(empty, (node) => String(node.props?.className ?? '') === 'dsh-feishu-empty').children.join(''), 'empty.messages');

  const many = Array.from({ length: 5 }, (_, index) => messageRow({ id: `om_${index}`, at: Date.UTC(2026, 8, 11, 6, index) }));
  // A dictionary that actually substitutes, so the cap message is checked as
  // the user would read it rather than as a key.
  const fill = (key) => (key === 'msg.capped' ? '只显示最近 {shown} 条（共 {total} 条）' : key);
  const capped = bundle.hooks.render(list, { bundle: { messages: many, fetchedAt: 1 }, self: {}, t: fill, face, max: 3 });
  const note = findNode(capped, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msgNote');
  assert.ok(note !== undefined, 'a capped list must say it is capped');
  assert.equal(note.children.join(''), '只显示最近 3 条（共 5 条）');
});

test('each message carries its own "add to input" line, beside the bubble', () => {
  const bundle = loadBundle();
  const written = [];
  const face = {
    insert: (text) => written.push(text),
    inserted: null,
    available: true,
    hint: 'action.insertHint',
  };
  const messages = [messageRow({ id: 'om_1', text: '明天对齐', lines: ['明天对齐'] })];
  const tree = flattenWithHooks(
    bundle.hooks.render(bundle.components.get('MessageList'), { bundle: { messages, fetchedAt: 1 }, self: {}, t: (key) => key, face }),
    bundle.hooks.render,
  );
  const button = allNodes(tree, (node) => node.type === 'button' && String(node.props.className).includes('dsh-feishu-btn'))
    .find((node) => String(node.children.join('')).includes('action.insert'));
  assert.ok(button !== undefined, 'a message must offer the insert action');
  button.props.onClick();
  assert.equal(written.length, 1);
  assert.ok(written[0].startsWith('> ['), `a quoted line is what gets inserted: ${JSON.stringify(written[0])}`);
  assert.ok(written[0].includes('张三') && written[0].includes('明天对齐'), written[0]);

  // The row's children are the avatar, the message, and the action — the action
  // is a sibling of the bubble rather than a sibling of its text, because a
  // button stacked underneath every message is what made the thread read as if
  // consecutive messages were a screen apart.
  const row = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msg')[0];
  assert.deepEqual(
    row.children.map((child) => String(child.props?.className ?? child.type ?? '')),
    ['dsh-feishu-msgAvatarSlot', 'dsh-feishu-msgMain', 'dsh-feishu-msgActions'],
  );
  const main = row.children[1];
  assert.equal(
    allNodes(main, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msgActions').length,
    0,
    'the action must not be inside the message column',
  );
});

test('a sender with no readable name is presented as unknown instead of invented', () => {
  const bundle = loadBundle();
  const { senderLabel, senderUnknown } = bundle.internals;
  const t = (key) => key;
  const face = { insert: () => {}, inserted: null, available: true, hint: '' };
  // What the host hands over for a sender the member list could not resolve:
  // the row is flagged, and the id-shaped `senderName` it carries for the
  // prompt must never reach the bubble.
  const unknown = messageRow({ id: 'om_x', senderId: 'ou_zhang', senderName: 'ou_zhang…', unresolved: true, text: '谁在说话', lines: ['谁在说话'] });
  const known = messageRow({ id: 'om_y', senderId: 'ou_li', senderName: '李四', text: '我', lines: ['我'] });
  assert.equal(senderUnknown(known), false);
  assert.equal(senderLabel(known, t), '李四');
  assert.equal(senderUnknown(unknown), true);
  assert.equal(senderLabel(unknown, t), 'msg.unknownSender');
  assert.equal(senderUnknown({ senderName: '' }), true, 'a blank name is unknown too');

  const tree = flattenWithHooks(
    bundle.hooks.render(bundle.components.get('MessageList'), { bundle: { messages: [unknown, known], fetchedAt: 1 }, self: {}, t, face }),
    bundle.hooks.render,
  );
  const sender = allNodes(tree, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msgSender')[0];
  assert.equal(sender.children.join(''), 'msg.unknownSender', 'the row names the gap rather than printing an id as a name');
  assert.equal(sender.props['data-unknown'], 'true');
  assert.equal(sender.props.title, 'ou_zhang', 'the id stays available on hover, where it is honest');
  const avatar = findNode(tree, (node) => String(node.props?.className ?? '').includes('dsh-feishu-avatarUnknown'));
  assert.ok(avatar !== undefined, 'an unknown sender must not get a per-id colored circle');
  assert.equal(avatar.children.join(''), '?');
  assert.equal(avatar.props.style, undefined, 'no hue is derived from an unknown identity');

  // The thread states the gap once, above the messages, rather than leaving rows
  // silently anonymous; a fully readable thread says nothing at all.
  const thread = flattenWithHooks(bundle.hooks.render(bundle.components.get('ChatThread'), {
    transcript: { chatName: '群一', messages: [unknown, known], truncated: false, memberLookup: { ok: true, count: 2, truncated: false }, fetchedAt: 1 },
    selected: undefined,
    t,
    face,
    self: {},
    busy: false,
  }), bundle.hooks.render);
  const note = findNode(thread, (node) => String(node.props?.className ?? '') === 'dsh-feishu-note');
  assert.ok(note !== undefined, 'an unknown sender deserves one note');
  assert.equal(note.props['data-tone'], 'warn');
  assert.ok(note.children.some((child) => typeof child === 'string' && child.includes('msg.unknownSenderHint')), `the note text must be a flat child: ${JSON.stringify(note.children)}`);

  // A row with no sender identity at all is not an unresolved name, so it must
  // not inflate the count.
  const senderless = messageRow({ id: 'om_z', senderId: '', senderName: undefined, text: '系统消息', lines: ['系统消息'] });
  const counted = flattenWithHooks(bundle.hooks.render(bundle.components.get('ChatThread'), {
    transcript: { chatName: '群一', messages: [unknown, senderless], truncated: false, memberLookup: { ok: true, count: 2, truncated: false }, fetchedAt: 1 },
    selected: undefined,
    t,
    face,
    self: {},
    busy: false,
  }), bundle.hooks.render);
  const countedNote = findNode(counted, (node) => String(node.props?.className ?? '') === 'dsh-feishu-note');
  assert.ok(countedNote.children.some((child) => typeof child === 'string' && child.endsWith('（1）')), `only the attributable row counts: ${JSON.stringify(countedNote.children)}`);

  const clean = flattenWithHooks(bundle.hooks.render(bundle.components.get('ChatThread'), {
    transcript: { chatName: '群一', messages: [known], truncated: false, memberLookup: { ok: true, count: 2, truncated: false }, fetchedAt: 1 },
    selected: undefined,
    t,
    face,
    self: {},
    busy: false,
  }), bundle.hooks.render);
  assert.equal(findNode(clean, (node) => String(node.props?.className ?? '') === 'dsh-feishu-note'), undefined);
});

test('the chats tab opens on the messages, not on the summary', () => {
  const bundle = loadBundle();
  const chatsView = bundle.components.get('ChatsView');
  const props = {
    chats: [{ id: 'oc_1', name: '群一' }],
    t: (key) => key,
    face: { insert: () => {}, inserted: null, available: true, hint: '' },
    summary: null,
    transcript: { chatName: '群一', messages: [messageRow({ id: 'om_1' })], truncated: false, memberLookup: { ok: true, count: 1, truncated: false }, fetchedAt: 1 },
    self: { id: '', name: '', avatar: undefined },
    busy: false,
    chatId: 'oc_1',
    hours: 24,
    sub: 'messages',
    onPick: () => {},
    onRange: () => {},
    onSub: () => {},
    onSummarize: () => {},
    onFetch: () => {},
    onLogin: () => {},
    auth: { showLogin: false, userLoggedIn: true, userName: '张三', onComplete: () => {} },
  };
  const messages = flattenWithHooks(bundle.hooks.render(chatsView, props), bundle.hooks.render);
  assert.equal(allNodes(messages, (node) => String(node.props?.className ?? '').includes('dsh-feishu-subtabs')).length, 1, 'the tab has a second-level switch');
  assert.equal(allNodes(messages, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msg').length, 1, 'messages are the default view');
  assert.equal(findNode(messages, (node) => String(node.props?.className ?? '') === 'dsh-feishu-summary'), undefined);

  // Switching to the summary view swaps the body but keeps the controls.
  const summaryView = flattenWithHooks(bundle.hooks.render(chatsView, {
    ...props,
    sub: 'summary',
    summary: { chatName: '群一', messageCount: 1, truncated: false, summary: '讨论了发版', keyPoints: [], actionItems: [], model: 'm', warning: undefined },
  }), bundle.hooks.render);
  assert.equal(allNodes(summaryView, (node) => String(node.props?.className ?? '') === 'dsh-feishu-msg').length, 0);
  assert.equal(findNode(summaryView, (node) => String(node.props?.className ?? '') === 'dsh-feishu-summary').children.join(''), '讨论了发版');
});

export { cases };
