/**
 * Pure-function cases for the Feishu projection layer.
 *
 * Message content is the one input this plugin cannot validate: it arrives as
 * a JSON-encoded string whose shape depends on `msg_type`, from a service the
 * plugin does not control. These cases pin every shape the plugin claims to
 * understand plus the degradation path for one it does not.
 *
 * @module dsh-feishu-plugin/test/feishu-content
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import {
  applyMentions,
  buildUrl,
  describeApiError,
  describeMessage,
  projectChat,
  projectMessage,
  projectTask,
  renderMessageContent,
  renderTranscript,
} from '../lib/feishu.mjs';

const { test, cases } = suite('feishu.content');

/** Wrap a content object the way the API returns it. */
const body = (value) => ({ body: { content: JSON.stringify(value) } });

test('text messages are unwrapped and whitespace-collapsed', () => {
  assert.equal(
    renderMessageContent({ msg_type: 'text', ...body({ text: '你好\n  世界  ' }) }),
    '你好 世界',
  );
});

test('post messages walk every locale body and keep links and mentions', () => {
  const message = {
    msg_type: 'post',
    ...body({
      title: '周会',
      content: {
        zh_cn: {
          content: [
            [{ tag: 'text', text: '本周结论：' }, { tag: 'at', user_name: '张三' }],
            [{ tag: 'a', text: '文档', href: 'https://example.com/doc' }, { tag: 'img' }],
          ],
        },
      },
    }),
  };
  const text = renderMessageContent(message);
  assert.equal(text, '周会 本周结论： @张三 文档(https://example.com/doc) [图片]');
});

test('card messages collect title, content and nested elements', () => {
  // Both shapes the API emits are covered: `title` as a plain string (the
  // documented card envelope) and `title.content` (the JSON-2.0 shape the
  // `card_msg_content_type=user_card_content` option returns).
  const message = {
    msg_type: 'interactive',
    ...body({
      header: { title: { content: '构建失败' } },
      elements: [
        [{ tag: 'div', text: { content: '主干编译失败，请尽快处理' } }],
        { tag: 'action', actions: [{ text: { content: '查看日志' } }] },
      ],
    }),
  };
  const text = renderMessageContent(message);
  assert.ok(text.includes('构建失败'), text);
  assert.ok(text.includes('主干编译失败'), text);
  assert.ok(text.includes('查看日志'), text);

  const flat = renderMessageContent({
    msg_type: 'interactive',
    ...body({ title: '值班提醒', elements: [{ tag: 'div', text: { content: '今晚 8 点交接' } }] }),
  });
  assert.equal(flat, '值班提醒 今晚 8 点交接');

  // A shape nobody enumerated must still contribute its text: the walker
  // recurses through every object-valued key rather than a fixed key list.
  const nested = renderMessageContent({
    msg_type: 'interactive',
    ...body({ body: { elements: [{ fields: [{ text: { tag: 'lark_md', content: '深层嵌套文本' } }] }] } }),
  });
  assert.equal(nested, '深层嵌套文本');
});

test('an empty card degrades to a label instead of an empty line', () => {
  assert.equal(renderMessageContent({ msg_type: 'interactive', ...body({ schema: '2.0' }) }), '[卡片消息]');
});

test('media-only messages produce a placeholder', () => {
  assert.equal(renderMessageContent({ msg_type: 'image', ...body({ image_key: 'img_x' }) }), '[图片]');
  assert.equal(renderMessageContent({ msg_type: 'file', ...body({ file_key: 'f' }) }), '[文件]');
});

test('an unknown msg_type still yields readable text', () => {
  assert.equal(renderMessageContent({ msg_type: 'quantum', ...body({}) }), '[quantum消息]');
});

test('recalled and deleted messages are dropped', () => {
  assert.equal(renderMessageContent({ msg_type: 'text', deleted: true, ...body({ text: 'This message was recalled' }) }), '');
});

test('malformed content JSON is passed through rather than throwing', () => {
  assert.equal(renderMessageContent({ msg_type: 'text', body: { content: 'not json at all' } }), 'not json at all');
});

test('projectTask normalizes due, completion, and task lists', () => {
  const task = projectTask({
    guid: 'g1',
    summary: '写周报',
    description: '本周进展',
    due: { timestamp: '1724284800000', is_all_day: true },
    completed_at: '0',
    tasklists: [{ tasklist_guid: 'tl1' }, { tasklist_guid: 'tl2' }],
  });
  assert.equal(task.id, 'g1');
  assert.equal(task.title, '写周报');
  assert.equal(task.due, 1724284800000);
  assert.equal(task.dueAllDay, true);
  assert.equal(task.completed, false);
  assert.deepEqual(task.tasklistNames, ['tl1', 'tl2']);
});

test('projectTask substitutes a title for an untitled task', () => {
  const task = projectTask({ guid: 'g2', completed_at: '1724284800000' });
  assert.equal(task.title, '(无标题任务)');
  assert.equal(task.completed, true);
  assert.equal(task.due, undefined);
});

test('projectChat names the unnamed and drops empty ids', () => {
  assert.equal(projectChat({ chat_id: 'oc_1' }).name, '(未命名群)');
  assert.equal(projectChat({ name: 'x' }).id, '');
});

test('projectMessage keeps sender identity and drops empty content', () => {
  const message = {
    message_id: 'om_1',
    msg_type: 'text',
    create_time: '1615380573411',
    sender: { id: 'ou_1', sender_type: 'user' },
    ...body({ text: '收到' }),
  };
  const projected = projectMessage(message, () => '张三');
  assert.equal(projected.senderName, '张三');
  assert.equal(projected.at, 1615380573411);
  assert.equal(projected.text, '收到');
  assert.equal(projected.kind, 'text');
  assert.deepEqual(projected.lines, ['收到']);
  assert.equal(projectMessage({ msg_type: 'image', ...body({}) }, () => 'x').text, '[图片]');
  assert.equal(projectMessage({ msg_type: 'image', ...body({}) }, () => 'x').kind, 'image');
});

test('a recalled message keeps its row but contributes no text', () => {
  // The chat view draws a system line for it, so the row cannot be dropped —
  // but the summary must not see it, which is what the empty text achieves.
  const dropped = projectMessage({ msg_type: 'text', deleted: true, ...body({ text: 'x' }) }, () => '张三');
  assert.equal(dropped.kind, 'recalled');
  assert.equal(dropped.text, '');
  assert.deepEqual(dropped.lines, []);
  assert.equal(dropped.senderName, '张三');
  assert.equal(renderMessageContent({ msg_type: 'text', deleted: true, ...body({ text: 'x' }) }), '');
  assert.equal(
    renderTranscript([{ at: 1, senderName: '张三', text: '' }, { at: 2, senderName: '李四', text: '在' }]).transcript,
    '[1970-01-01 00:00] 李四: 在',
    'a row with no text must not reach the prompt',
  );
});

test('mention keys are substituted with the names beside them', () => {
  // Feishu puts `@_user_N` in the text and the names in a separate array: both
  // the prompt and the bubble need them joined.
  assert.equal(applyMentions('@_user_1 看一下', [{ key: '@_user_1', name: '张三' }]), '@张三 看一下');
  assert.equal(applyMentions('@_user_1 和 @_user_2', [{ key: '@_user_1', name: '张三' }]), '@张三 和 @_user_2');
  assert.equal(applyMentions('没有提及', undefined), '没有提及');
  assert.equal(applyMentions('@_user_1', [{ key: '@_user_1', name: '' }]), '@_user_1', 'a nameless mention stays raw');

  const message = {
    message_id: 'om_2',
    msg_type: 'text',
    create_time: '1615380573411',
    sender: { id: 'ou_1', sender_type: 'user' },
    mentions: [{ key: '@_user_9', id: 'ou_9', name: '李四' }],
    ...body({ text: '@_user_9 帮忙看下' }),
  };
  assert.equal(renderMessageContent(message), '@李四 帮忙看下');
  const projected = projectMessage(message, () => '张三');
  assert.deepEqual(projected.mentions, [{ key: '@_user_9', name: '李四' }]);
  assert.equal(projected.text, '@李四 帮忙看下');
  // The bubble draws `lines`, not `text`: leaving the keys there would show
  // `@_user_9` on screen while the prompt said `@李四`.
  assert.deepEqual(projected.lines, ['@李四 帮忙看下']);
});

test('describeMessage keeps the keys a chat bubble needs and drops them from the text', () => {
  const image = describeMessage({ msg_type: 'image', ...body({ image_key: 'img_v2_abc' }) });
  assert.equal(image.kind, 'image');
  assert.equal(image.text, '[图片]');
  assert.deepEqual(image.media, { imageKey: 'img_v2_abc' });

  const file = describeMessage({ msg_type: 'file', ...body({ file_key: 'file_1', file_name: '周报.pdf' }) });
  assert.equal(file.kind, 'file');
  assert.deepEqual(file.media, { fileKey: 'file_1', fileName: '周报.pdf' });

  const audio = describeMessage({ msg_type: 'audio', ...body({ file_key: 'file_a', duration: 3200 }) });
  assert.equal(audio.kind, 'audio');
  assert.deepEqual(audio.media, { fileKey: 'file_a', fileName: undefined, durationMs: 3200, coverImageKey: undefined });

  const video = describeMessage({ msg_type: 'media', ...body({ file_key: 'file_v', duration: 9000, image_key: 'img_c' }) });
  assert.equal(video.kind, 'video');
  assert.equal(video.media.durationMs, 9000);
  assert.equal(video.media.coverImageKey, 'img_c');

  // A post keeps its paragraphs for the bubble while the prompt text stays one
  // collapsed line — the two have different jobs.
  const post = describeMessage({
    msg_type: 'post',
    ...body({
      title: '周会',
      content: { zh_cn: { content: [[{ tag: 'text', text: '第一段' }], [{ tag: 'text', text: '第二段' }]] } },
    }),
  });
  assert.equal(post.kind, 'post');
  assert.deepEqual(post.lines, ['第一段', '第二段']);
  assert.equal(post.media.title, '周会');
  assert.equal(post.text, '周会 第一段 第二段');

  const card = describeMessage({
    msg_type: 'interactive',
    ...body({ header: { title: { content: '构建失败' } }, elements: [{ tag: 'div', text: { content: '看日志' } }] }),
  });
  assert.equal(card.kind, 'card');
  assert.deepEqual(card.media, { title: '构建失败' });
  assert.ok(card.text.includes('看日志'), card.text);

  // A text message keeps its own line breaks for the bubble: `tidy` collapsed
  // them out of the prompt text, so they cannot be recovered from there.
  const text = describeMessage({ msg_type: 'text', ...body({ text: '第一行\n第二行' }) });
  assert.deepEqual(text.lines, ['第一行', '第二行']);
  assert.equal(text.text, '第一行 第二行');

  const unknown = describeMessage({ msg_type: 'quantum', ...body({}) });
  assert.equal(unknown.kind, 'other');
  assert.equal(unknown.text, '[quantum消息]');
});

test('a quote keeps the parent id for the view without leaking it into the text', () => {
  const message = {
    message_id: 'om_reply',
    parent_id: 'om_parent',
    root_id: 'om_root',
    thread_id: 'omt_1',
    updated: true,
    msg_type: 'text',
    create_time: '1615380573411',
    sender: { id: 'ou_2', sender_type: 'app' },
    ...body({ text: '好的' }),
  };
  const projected = projectMessage(message, () => '应用');
  assert.equal(projected.parentId, 'om_parent');
  assert.equal(projected.rootId, 'om_root');
  assert.equal(projected.threadId, 'omt_1');
  assert.equal(projected.updated, true);
  assert.equal(projected.senderType, 'app');
  assert.equal(projected.text, '好的');

  // A row with no ids at all must not invent empty ones: the view branches on
  // `undefined`, not on a falsy string.
  const bare = projectMessage({ msg_type: 'text', ...body({ text: 'x' }) }, () => 'x');
  assert.equal(bare.parentId, undefined);
  assert.equal(bare.rootId, undefined);
  assert.equal(bare.threadId, undefined);
});

test('renderTranscript keeps the newest lines inside the character budget', () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({
    at: 1615380573411 + index * 1000,
    senderName: `用户${index}`,
    text: `第 ${index} 条消息`,
  }));
  const rendered = renderTranscript(messages, { maxChars: 60 });
  assert.ok(rendered.truncated, 'a tiny budget must report truncation');
  assert.ok(rendered.included < messages.length);
  assert.ok(rendered.transcript.includes('第 9 条消息'), 'the newest message must survive');
  assert.ok(!rendered.transcript.includes('第 0 条消息'), 'the oldest message must be dropped first');
});

test('renderTranscript emits an empty transcript for no messages', () => {
  const rendered = renderTranscript([]);
  assert.equal(rendered.transcript, '');
  assert.equal(rendered.included, 0);
  assert.equal(rendered.truncated, false);
});

test('buildUrl keeps the base path and drops empty query values', () => {
  const url = buildUrl('https://open.feishu.cn', '/open-apis/im/v1/messages', {
    container_id: 'oc_1',
    page_token: undefined,
    page_size: 50,
  });
  assert.equal(url, 'https://open.feishu.cn/open-apis/im/v1/messages?container_id=oc_1&page_size=50');
  assert.equal(buildUrl('http://127.0.0.1:1/', '/x'), 'http://127.0.0.1:1/x');
});

test('describeApiError attaches the known repair hint', () => {
  const text = describeApiError({ code: 230002, msg: 'The bot can not be outside the group.' });
  assert.ok(text.includes('230002'), text);
  assert.ok(text.includes('机器人不在这个群里'), text);
  const unknown = describeApiError({ code: 999999, msg: 'mystery' });
  assert.ok(unknown.includes('mystery') && !unknown.includes('\n'), unknown);
});

export { cases };
