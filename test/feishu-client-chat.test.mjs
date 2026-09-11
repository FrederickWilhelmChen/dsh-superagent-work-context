/**
 * Integration cases for the calls the chat view needs: member names, the
 * authorizing user's own identity, and message resources.
 *
 * @module dsh-feishu-plugin/test/feishu-client-chat
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { suite } from './harness.mjs';
import { TENANT_TOKEN, USER_TOKEN, clientFor, startStub } from './feishu-client-harness.mjs';
import { FeishuError, createFeishuClient } from '../lib/feishu.mjs';

const { test, cases } = suite('feishu.client.chat');

test('listChatMembers resolves names and pages to completion', async () => {
  const stub = await startStub((_req, url) => {
    assert.equal(url.pathname, '/open-apis/im/v1/chats/oc_1/members');
    assert.equal(url.searchParams.get('member_id_type'), 'open_id');
    if (url.searchParams.get('page_token') === null) {
      return { body: { code: 0, data: { items: [{ member_id: 'ou_1', name: '张三' }], has_more: true, page_token: 'p2' } } };
    }
    return { body: { code: 0, data: { items: [{ member_id: 'ou_2', name: '李四' }, { member_id: 'ou_3', name: '' }], has_more: false } } };
  });
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN, userTokenExpiresAt: Date.now() + 3_600_000 });
    const result = await client.listChatMembers({ chatId: 'oc_1' });
    // The nameless row is dropped rather than cached as an empty name, and the
    // bot token is used even though a live user token exists: the member list
    // needs an operator *in the chat*, and the chats here are the bot's.
    assert.deepEqual(result.items, [{ id: 'ou_1', name: '张三' }, { id: 'ou_2', name: '李四' }]);
    assert.equal(result.truncated, false);
    assert.equal(stub.calls.at(-1).auth, `Bearer ${TENANT_TOKEN}`);
  } finally {
    await stub.close();
  }
});

test('an unreadable member list is reported instead of thrown', async () => {
  // The member list is the one part of a transcript that can fail on its own —
  // an operator outside the chat gets `232011`. Losing the messages over it
  // would be a much worse answer than unnamed bubbles.
  const stub = await startStub(() => ({ status: 400, body: { code: 232011, msg: 'operator can NOT be out of the chat' } }));
  try {
    const client = clientFor(stub);
    const result = await client.listChatMembers({ chatId: 'oc_1' });
    assert.equal(result.unreadable, true);
    assert.deepEqual(result.items, []);
    assert.ok(result.error.includes('232011'), result.error);
  } finally {
    await stub.close();
  }
});

test('a user token that is not in the chat falls back to the bot token', async () => {
  // `prefer: auto` tries the user token first. For a group the bot is in but the
  // user is not, that token is answered with 232011 — a credential mismatch, not
  // a dead end, so the tenant token has to get its turn.
  let attempts = 0;
  const stub = await startStub((req) => {
    attempts += 1;
    if (req.headers.authorization === `Bearer ${USER_TOKEN}`) {
      return { status: 400, body: { code: 232011, msg: 'operator can NOT be out of the chat' } };
    }
    return { body: { code: 0, data: { items: [{ message_id: 'om_1', msg_type: 'text', body: { content: '{"text":"在"}' } }], has_more: false } } };
  });
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN, userTokenExpiresAt: Date.now() + 3_600_000 });
    const result = await client.listMessages({ chatId: 'oc_1' });
    assert.equal(result.items.length, 1);
    assert.equal(attempts, 2, 'the tenant token must have been tried after the user token was refused');
  } finally {
    await stub.close();
  }
});

test('getUserInfo reads the profile behind the user token', async () => {
  const stub = await startStub((_req, url) => {
    assert.equal(url.pathname, '/open-apis/authen/v1/user_info');
    return { body: { code: 0, data: { name: '张三', open_id: 'ou_me', avatar_url: 'https://example.com/a.png' } } };
  });
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN, userTokenExpiresAt: Date.now() + 3_600_000 });
    const self = await client.getUserInfo();
    assert.deepEqual(self, { id: 'ou_me', name: '张三', avatar: 'https://example.com/a.png' });
    assert.equal(stub.calls.at(-1).auth, `Bearer ${USER_TOKEN}`, 'the profile endpoint needs the user token');

    // The auth flow hands over the token it just received: at that moment the
    // settings document may not expose it yet, so reading it back would race
    // the write that stored it.
    const explicit = await client.getUserInfo({ accessToken: 'u-fresh-from-exchange' });
    assert.equal(explicit.id, 'ou_me');
    assert.equal(stub.calls.at(-1).auth, 'Bearer u-fresh-from-exchange');
  } finally {
    await stub.close();
  }
});

test('getMessageResource returns the bytes and their metadata', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    // One server both mints the token and serves the resource, so the path
    // decides which kind of body comes back — a stub that answered every
    // request with the image would make the token call look like a failure.
    if (url.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      const payload = Buffer.from(JSON.stringify({ code: 0, tenant_access_token: 't-stub', expire: 7200 }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(payload.length), connection: 'close' });
      res.end(payload);
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(bytes.length), connection: 'close' });
    res.end(bytes);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const seen = [];
  const client = createFeishuClient({
    getConfig: () => ({ appId: 'cli_stub', appSecret: 'secret', baseUrl }),
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.authorization, range: init?.headers?.range });
      return fetch(url, init);
    },
  });
  try {
    const result = await client.getMessageResource({ messageId: 'om_1', fileKey: 'img_1', type: 'image', range: 'bytes=0-3' });
    assert.equal(result.contentType, 'image/png');
    assert.equal(result.buffer.toString('hex'), bytes.toString('hex'));
    // Two requests: the bot token is minted first, then the resource is read
    // with it. A second read reuses the cached token.
    assert.equal(seen.length, 2, `expected a token mint then the read: ${JSON.stringify(seen)}`);
    assert.ok(seen[1].url.includes('/open-apis/im/v1/messages/om_1/resources/img_1?type=image'), seen[1].url);
    assert.equal(seen[1].auth, 'Bearer t-stub', 'the resource read needs a credential');
    assert.equal(seen[1].range, 'bytes=0-3', 'a Range request is passed through for media seeking');
    await client.getMessageResource({ messageId: 'om_1', fileKey: 'img_1', type: 'image' });
    assert.equal(seen.length, 3, 'the cached token must not be minted again');
  } finally {
    await new Promise((done) => server.close(() => done()));
  }
});

test('a refused resource read becomes a FeishuError with its repair hint', async () => {
  // The failure path of the media relay: Feishu answers a bad resource with a
  // JSON error body even though the success path is binary, so the error has to
  // be parsed out of it rather than surfaced as a broken image.
  const stub = await startStub((_req, url) => {
    assert.ok(url.pathname.startsWith('/open-apis/im/v1/messages/'), url.pathname);
    return { status: 400, body: { code: 234004, msg: 'App not in chat.' } };
  });
  try {
    const client = clientFor(stub);
    await assert.rejects(
      () => client.getMessageResource({ messageId: 'om_1', fileKey: 'img_1', type: 'image' }),
      (error) => {
        assert.ok(error instanceof FeishuError, `expected FeishuError, got ${error}`);
        assert.equal(error.code, 234004);
        assert.ok(error.message.includes('下载消息资源'), error.message);
        return true;
      },
    );
  } finally {
    await stub.close();
  }
});

export { cases };
