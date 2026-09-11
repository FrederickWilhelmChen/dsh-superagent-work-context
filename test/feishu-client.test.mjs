/**
 * Integration cases for the credential planes and the task endpoints, against
 * a local stub of the Feishu open API.
 *
 * @module dsh-feishu-plugin/test/feishu-client
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import { TENANT_TOKEN, USER_TOKEN, clientFor, startStub } from './feishu-client-harness.mjs';
import { FeishuError, REQUIRED_SCOPES } from '../lib/feishu.mjs';

const { test, cases } = suite('feishu.client');

test('listChats pages to completion and reports no truncation', async () => {
  const stub = await startStub((_req, url) => {
    const token = url.searchParams.get('page_token');
    if (token === null) {
      return {
        body: {
          code: 0,
          data: {
            items: [
              { chat_id: 'oc_1', name: '群一', chat_status: 'normal' },
              { chat_id: 'oc_2', name: '群二', chat_status: 'normal' },
            ],
            has_more: true,
            page_token: 'page-2',
          },
        },
      };
    }
    return { body: { code: 0, data: { items: [{ chat_id: 'oc_3', name: '群三' }], has_more: false } } };
  });
  try {
    const client = clientFor(stub);
    const result = await client.listChats({ limit: 10 });
    assert.equal(result.items.length, 3);
    assert.equal(result.truncated, false);
    const dataCalls = stub.calls.filter((call) => call.path === '/open-apis/im/v1/chats');
    assert.ok(dataCalls.length > 0, 'the chat endpoint must have been called');
    assert.equal(dataCalls[0].auth, `Bearer ${TENANT_TOKEN}`, 'chat listing uses the bot token');
  } finally {
    await stub.close();
  }
});

test('listChats stops at the limit and reports truncation', async () => {
  const stub = await startStub(() => ({
    body: {
      code: 0,
      data: {
        items: Array.from({ length: 50 }, (_, index) => ({ chat_id: `oc_${index}`, name: `群${index}` })),
        has_more: true,
        page_token: 'always-more',
      },
    },
  }));
  try {
    const client = clientFor(stub);
    const result = await client.listChats({ limit: 60 });
    assert.equal(result.items.length, 60);
    // The server still offers another page, so the caller must be told the
    // answer is partial rather than being handed a silently short list.
    assert.equal(result.truncated, true);
  } finally {
    await stub.close();
  }
});

test('listRecentMessages reverse-pages into chronological order', async () => {
  // Descending paging: the stub returns newest-first, so the client must flip
  // the collected pages back before prompting.
  const stub = await startStub((_req, url) => {
    const token = url.searchParams.get('page_token');
    assert.equal(url.searchParams.get('sort_type'), 'ByCreateTimeDesc');
    if (token === null) {
      return {
        body: {
          code: 0,
          data: {
            items: [
              { message_id: 'om_5', msg_type: 'text', create_time: '5000', sender: { id: 'ou_1' }, body: { content: '{"text":"第五条"}' } },
              { message_id: 'om_4', msg_type: 'text', create_time: '4000', sender: { id: 'ou_1' }, body: { content: '{"text":"第四条"}' } },
            ],
            has_more: true,
            page_token: 'older',
          },
        },
      };
    }
    return {
      body: {
        code: 0,
        data: {
          items: [
            { message_id: 'om_3', msg_type: 'text', create_time: '3000', sender: { id: 'ou_1' }, body: { content: '{"text":"第三条"}' } },
          ],
          has_more: false,
        },
      },
    };
  });
  try {
    const client = clientFor(stub);
    const result = await client.listRecentMessages({ chatId: 'oc_1', limit: 10 });
    assert.deepEqual(result.items.map((item) => item.message_id), ['om_3', 'om_4', 'om_5']);
  } finally {
    await stub.close();
  }
});

test('listMyTasks requires a user token and refuses without one', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: { items: [], has_more: false } } }));
  try {
    const client = clientFor(stub);
    await assert.rejects(
      () => client.listMyTasks({ limit: 10 }),
      (error) => error instanceof FeishuError && /没有可用的 user token/.test(error.message),
    );
  } finally {
    await stub.close();
  }
});

test('listMyTasks sends the user token and parses tasks', async () => {
  const stub = await startStub((_req, url) => {
    assert.equal(url.searchParams.get('type'), 'my_tasks');
    return {
      body: {
        code: 0,
        data: {
          items: [{ guid: 'g1', summary: '写周报', completed_at: '0', due: { timestamp: '1800000000000', is_all_day: false } }],
          has_more: false,
        },
      },
    };
  });
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN });
    const result = await client.listMyTasks({ limit: 10, completed: false });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].summary, '写周报');
    assert.equal(stub.calls.at(-1).auth, `Bearer ${USER_TOKEN}`);
  } finally {
    await stub.close();
  }
});

test('a Feishu business error becomes a FeishuError with its repair hint', async () => {
  const stub = await startStub(() => ({ status: 400, body: { code: 230002, msg: 'The bot can not be outside the group.' } }));
  try {
    const client = clientFor(stub);
    await assert.rejects(
      () => client.listChats({ limit: 1 }),
      (error) => {
        assert.ok(error instanceof FeishuError, `expected FeishuError, got ${error}`);
        assert.equal(error.code, 230002);
        assert.ok(error.hint.includes('机器人不在这个群里'), error.hint);
        return true;
      },
    );
  } finally {
    await stub.close();
  }
});

test('the tenant token is cached across calls', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: { items: [], has_more: false } } }));
  try {
    const client = clientFor(stub);
    await client.listChats({ limit: 1 });
    await client.listChats({ limit: 1 });
    const tokenCalls = stub.calls.filter((call) => call.path.endsWith('/tenant_access_token/internal'));
    assert.equal(tokenCalls.length, 1, 'the bot token must be reused until it expires');
  } finally {
    await stub.close();
  }
});

test('resetToken forces a fresh tenant token', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: { items: [], has_more: false } } }));
  try {
    const client = clientFor(stub);
    await client.listChats({ limit: 1 });
    client.resetToken();
    await client.listChats({ limit: 1 });
    const tokenCalls = stub.calls.filter((call) => call.path.endsWith('/tenant_access_token/internal'));
    assert.equal(tokenCalls.length, 2);
  } finally {
    await stub.close();
  }
});

test('missing credentials fail with the settings-document hint before any request', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: {} } }));
  try {
    const client = clientFor(stub, { appId: '', appSecret: '' });
    await assert.rejects(
      () => client.listChats({ limit: 1 }),
      (error) => {
        assert.ok(error instanceof FeishuError, `expected FeishuError, got ${error}`);
        // The hint must name the path that actually works — the settings
        // document, which the provider hot-reloads — not a settings-page card,
        // which the Web settings page does not draw for a third-party namespace.
        assert.ok(error.hint.includes('apply-settings.mjs'), error.hint);
        assert.ok(error.hint.includes('settings.yaml'), error.hint);
        return true;
      },
    );
    assert.equal(stub.calls.length, 0, 'nothing must be sent to Feishu without credentials');
  } finally {
    await stub.close();
  }
});

test('exchangeCode returns the token bundle and rejects a bad code', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: {} } }));
  try {
    const client = clientFor(stub);
    const bundle = await client.exchangeCode({ code: 'good', redirectUri: 'http://127.0.0.1/cb' });
    assert.equal(bundle.accessToken, USER_TOKEN);
    assert.equal(bundle.refreshToken, 'ur-refresh-1');
    assert.equal(bundle.expiresIn, 7200);
    const sent = stub.calls.at(-1).body;
    assert.equal(sent.grant_type, 'authorization_code');
    assert.equal(sent.client_id, 'cli_stub');
    assert.equal(sent.redirect_uri, 'http://127.0.0.1/cb');
  } finally {
    await stub.close();
  }
});

test('refreshUserToken returns the rotated refresh token', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: {} } }));
  try {
    const client = clientFor(stub);
    const bundle = await client.refreshUserToken({ refreshToken: 'ur-refresh-1' });
    assert.equal(bundle.accessToken, 'u-refreshed');
    assert.equal(bundle.refreshToken, 'ur-refresh-2');
    assert.equal(stub.calls.at(-1).body.grant_type, 'refresh_token');
  } finally {
    await stub.close();
  }
});

test('completeTask PATCHes completed_at with the user token', async () => {
  const stub = await startStub((req, url) => {
    if (req.method === 'PATCH' && url.pathname === '/open-apis/task/v2/tasks/g1') {
      return { body: { code: 0, data: { task: { guid: 'g1' } } } };
    }
    return undefined;
  });
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN });
    const data = await client.completeTask({ taskGuid: 'g1', completed: true });
    assert.equal(data.task.guid, 'g1');
    const sent = stub.calls.at(-1);
    assert.equal(sent.method, 'PATCH');
    assert.deepEqual(sent.body.update_fields, ['completed_at']);
    assert.ok(Number(sent.body.task.completed_at) > 0);
  } finally {
    await stub.close();
  }
});

test('a completion writes a timestamp and a reopen clears it', async () => {
  // This button mutates the user's real Feishu data, so the wire contract is
  // pinned: completing sends a millisecond timestamp, and reopening sends "0"
  // — Feishu's documented way to restore an uncompleted task.
  const stub = await startStub((req, url) => (
    req.method === 'PATCH' && url.pathname.startsWith('/open-apis/task/v2/tasks/')
      ? { body: { code: 0, data: {} } }
      : undefined
  ));
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN });
    await client.completeTask({ taskGuid: 'g1', completed: true });
    await client.completeTask({ taskGuid: 'g1', completed: false });
    const stamps = stub.calls.filter((call) => call.method === 'PATCH').map((call) => call.body.task.completed_at);
    assert.equal(stamps.length, 2);
    assert.ok(Number(stamps[0]) > 0, 'completion carries a real timestamp');
    assert.equal(stamps[1], '0', 'reopening clears completed_at');
  } finally {
    await stub.close();
  }
});

test('a missing write scope surfaces the re-authorization hint', async () => {
  const stub = await startStub(() => ({
    status: 400,
    body: {
      code: 99991679,
      msg: 'Unauthorized. required one of these privileges under the user identity: [task:task:writeonly, task:task:write]',
    },
  }));
  try {
    const client = clientFor(stub, { userToken: USER_TOKEN });
    await assert.rejects(
      () => client.completeTask({ taskGuid: 'g1', completed: true }),
      (error) => {
        assert.ok(error instanceof FeishuError, `expected FeishuError, got ${error}`);
        assert.equal(error.code, 99991679);
        assert.ok(error.hint.includes('重新授权'), error.hint);
        assert.ok(error.hint.includes('权限管理'), error.hint);
        return true;
      },
    );
  } finally {
    await stub.close();
  }
});

test('the requested scopes include the task write scope the panel needs', () => {
  // Read scope is not enough for the 完成 button; a grant that lacks write fails
  // only when the button is pressed, so it must be requested up front.
  assert.ok(REQUIRED_SCOPES.includes('task:task:write'), REQUIRED_SCOPES.join(' '));
  assert.ok(REQUIRED_SCOPES.includes('task:task:read'), REQUIRED_SCOPES.join(' '));
  assert.ok(REQUIRED_SCOPES.includes('offline_access'), REQUIRED_SCOPES.join(' '));
});

test('authorizeUrl carries the app id, redirect and scopes', async () => {
  const stub = await startStub(() => ({ body: { code: 0, data: {} } }));
  try {
    const client = clientFor(stub);
    const url = new URL(client.authorizeUrl({ redirectUri: 'http://127.0.0.1:3080/plugin/feishu/api/auth/callback', state: 'st' }));
    assert.equal(url.origin, 'https://accounts.feishu.cn');
    assert.equal(url.pathname, '/open-apis/authen/v1/authorize');
    assert.equal(url.searchParams.get('client_id'), 'cli_stub');
    assert.equal(url.searchParams.get('state'), 'st');
    const scopes = url.searchParams.get('scope');
    assert.ok(scopes.includes('task:task:read'), scopes);
    // offline_access is what makes Feishu return a refresh token; without it
    // the login would silently degrade every couple of hours.
    assert.ok(scopes.includes('offline_access'), scopes);
  } finally {
    await stub.close();
  }
});

test('listTasklistTasks filters by completion and follows pages', async () => {
  const stub = await startStub((_req, url) => {
    assert.equal(url.pathname, '/open-apis/task/v2/tasklists/tl-1/tasks');
    assert.equal(url.searchParams.get('completed'), 'false');
    return {
      body: {
        code: 0,
        data: {
          items: [{ guid: 'g9', summary: '清单任务', completed_at: '0' }],
          has_more: false,
        },
      },
    };
  });
  try {
    const client = clientFor(stub);
    const result = await client.listTasklistTasks({ tasklistGuid: 'tl-1', limit: 10, completed: false });
    assert.equal(result.items[0].guid, 'g9');
    // No user token stored, so the fallback path uses the bot credential.
    assert.equal(stub.calls.at(-1).auth, `Bearer ${TENANT_TOKEN}`);
  } finally {
    await stub.close();
  }
});

export { cases };
