/**
 * Cases for the chat-facing routes: the transcript bundle, member names, and
 * the media relay.
 *
 * @module dsh-feishu-plugin/test/routes-chat
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import { API_PREFIX } from '../lib/index.js';
import { callJson, chatStubHandler, start, startFeishuStub } from './routes-harness.mjs';

const { test, cases } = suite('routes.chat');

test('the transcript carries display names, chat context, and who the user is', async () => {
  const feishu = await startFeishuStub(chatStubHandler());
  const host = await start({
    config: {
      appId: 'cli_stub',
      appSecret: 's',
      baseUrl: feishu.origin,
      userName: '我的名字',
      userId: 'ou_zhang',
      userAvatar: 'https://example.com/me.png',
    },
  });
  try {
    // The group list first: the bundle's chat context comes from it.
    const chats = await callJson(host.baseUrl, '/api/chats/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(chats.body.ok, true, JSON.stringify(chats.body));

    const result = await callJson(host.baseUrl, '/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'oc_1', hours: 24 }),
    });
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    const bundle = result.body.data;
    // Names come from the member list; the mention is a second source, and a
    // short id is the honest last resort.
    assert.equal(bundle.messages[0].senderName, '张三');
    assert.equal(bundle.messages[0].text, '@李四 看下这个');
    assert.equal(bundle.messages[1].senderName, '李四');
    assert.equal(bundle.messages[1].kind, 'image');
    assert.deepEqual(bundle.messages[1].media, { imageKey: 'img_v2_x' });
    // The recalled row stays for the view but contributes no text.
    assert.equal(bundle.messages[2].kind, 'recalled');
    assert.equal(bundle.messages[2].text, '');
    assert.equal(bundle.textCount, 2, 'only rows with text are summarizable');
    assert.equal(bundle.messageCount, 3);
    assert.equal(bundle.memberLookup.ok, true);
    assert.equal(bundle.memberLookup.count, 2);
    assert.equal(bundle.chat.name, 'DragonBowl 工作组');
    assert.equal(bundle.chat.avatar, 'https://example.com/g.png');
    assert.deepEqual(bundle.self, { id: 'ou_zhang', name: '我的名字', avatar: 'https://example.com/me.png' });
    assert.ok(bundle.transcript.includes('张三: @李四 看下这个'), bundle.transcript);
    assert.ok(!bundle.transcript.includes('This message was recalled'), 'a recalled row must not reach the prompt');
    // A media row reaches the prompt as its placeholder — the model should know
    // an image was sent — but never as the raw content JSON.
    assert.ok(bundle.transcript.includes('李四: [图片]'), bundle.transcript);
    assert.ok(!bundle.transcript.includes('img_v2_x'), 'resource keys are display data, not prompt data');
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('a failed member lookup degrades to short ids instead of losing the messages', async () => {
  const feishu = await startFeishuStub(chatStubHandler({ memberFailure: 232011 }));
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's', baseUrl: feishu.origin } });
  try {
    const result = await callJson(host.baseUrl, '/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'oc_1', hours: 24 }),
    });
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    const bundle = result.body.data;
    assert.equal(bundle.memberLookup.ok, false);
    assert.ok(bundle.memberLookup.error.includes('232011'), bundle.memberLookup.error);
    assert.equal(bundle.messages.length, 3, 'the messages must survive a name failure');
    // No name is invented for a sender the lookup could not resolve: the row is
    // flagged instead, which is what makes the panel say 「未知成员」 rather than
    // print the id as if it were a nickname. The id-shaped placeholder survives
    // only for the prompt, where a model needs a handle to tell speakers apart.
    assert.equal(bundle.messages[0].unresolved, true, 'an unresolved sender must be flagged');
    assert.equal(bundle.messages[0].senderId, 'ou_zhang');
    assert.equal(bundle.messages[0].senderName, 'ou_zhang…', 'the prompt keeps a handle for the speaker');
    assert.ok(bundle.transcript.includes('ou_zhang…:'), bundle.transcript);
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('a window of nothing but recalled messages is not summarizable', async () => {
  const recalled = [{
    message_id: 'om_r',
    msg_type: 'text',
    deleted: true,
    create_time: '1760000000000',
    sender: { id: 'ou_li', sender_type: 'user' },
    body: { content: JSON.stringify({ text: 'This message was recalled' }) },
  }];
  const feishu = await startFeishuStub(chatStubHandler({ messages: recalled }));
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's', baseUrl: feishu.origin } });
  try {
    const result = await callJson(host.baseUrl, '/api/summarize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'oc_1', hours: 24 }),
    });
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.message.includes('没有可总结的文本消息'), result.body.error.message);
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('the media route relays bytes, and refuses ids it did not build itself', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let asked = '';
  const feishu = await startFeishuStub((url) => {
    if (url.pathname.startsWith('/open-apis/im/v1/messages/')) {
      asked = url.pathname + url.search;
      return { raw: png, contentType: 'image/png' };
    }
    return undefined;
  });
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's', baseUrl: feishu.origin } });
  try {
    const response = await fetch(`${host.baseUrl}${API_PREFIX}/api/media?messageId=om_1&fileKey=img_v2_x&type=image`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'private, max-age=86400');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.toString('hex'), png.toString('hex'));
    assert.equal(asked, '/open-apis/im/v1/messages/om_1/resources/img_v2_x?type=image');

    // The route builds the Feishu URL from these two ids, so anything that is
    // not an id — a path, a full URL, a traversal attempt — is refused before a
    // request is made.
    for (const query of [
      'messageId=../../etc/passwd&fileKey=img_x&type=image',
      'messageId=om_1&fileKey=https://evil.example/x&type=image',
      'messageId=om_1&fileKey=img_x&type=file://x',
    ]) {
      const refused = await fetch(`${host.baseUrl}${API_PREFIX}/api/media?${query}`);
      assert.equal(refused.status, 400, query);
      const body = await refused.json();
      assert.equal(body.ok, false);
    }
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('state reports who the panel is acting as', async () => {
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's', userId: 'ou_me', userName: '张三', userAvatar: 'https://example.com/a.png' } });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.equal(result.body.data.selfId, 'ou_me');
    assert.equal(result.body.data.userName, '张三');
    assert.equal(result.body.data.selfAvatar, 'https://example.com/a.png');
  } finally {
    await host.close();
  }
});


export { cases };
