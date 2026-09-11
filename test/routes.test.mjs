/**
 * Cases for the plugin's HTTP surface, driven through the real handler.
 *
 * The DSH plugin's routes are a contract two other parties depend on: the
 * browser half, and — for a deployment whose Feishu app must keep its own
 * callback domain — the user's own service forwarding an authorization code.
 * Both are pinned here against the actual `apply()` registration, with a stub
 * context standing in for the host.
 *
 * @module dsh-feishu-plugin/test/routes
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { suite } from './harness.mjs';
import { callJson, start, startFeishuStub } from './routes-harness.mjs';
import { API_PREFIX, TASKS_ERROR_TTL_MS, TASKS_TTL_MS, planTaskRead } from '../lib/index.js';
import { DEFAULT_OAUTH_TOKEN_URL } from '../lib/feishu.mjs';

const { test, cases } = suite('routes');

test('a GET callback with a code reports the browser-facing page', async () => {
  const host = await start();
  try {
    // No credentials are configured, so the exchange must fail — but it must
    // fail as JSON with the exchange error, not as a 500 or a crash.
    const response = await fetch(`${host.baseUrl}${API_PREFIX}/api/auth/callback?code=fake-code&state=whatever`);
    assert.equal(response.status, 200, 'the callback always answers 200 with its own verdict');
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.ok(body.error.message.includes('App ID'), body.error.message);
  } finally {
    await host.close();
  }
});

test('a GET callback without a code says so instead of throwing', async () => {
  const host = await start();
  try {
    const result = await callJson(host.baseUrl, '/api/auth/callback');
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.message.includes('没有 code'), result.body.error.message);
  } finally {
    await host.close();
  }
});

test('POST /api/auth/complete accepts a bare code', async () => {
  // A stub OAuth endpoint: the exchange succeeds, so the whole forwarding path
  // — code in, token stored — is covered without reaching Feishu.
  const tokenServer = createServer((req, res) => {
    const payload = Buffer.from(JSON.stringify({
      code: 0,
      access_token: 'u-forwarded',
      refresh_token: 'ur-forwarded',
      expires_in: 7200,
      scope: 'task:task:read offline_access',
    }));
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(payload.length) });
    res.end(payload);
  });
  await new Promise((done) => tokenServer.listen(0, '127.0.0.1', done));
  const tokenUrl = `http://127.0.0.1:${tokenServer.address().port}/oauth/v3/token`;

  /** @type {any[]} */
  const updates = [];
  const host = await start({
    config: { appId: 'cli_stub', appSecret: 'secret', oauthTokenUrl: tokenUrl },
    services: {
      settings: {
        installSection: () => {},
        update: async (namespace, patch) => {
          updates.push({ namespace, patch });
        },
      },
    },
  });
  try {
    assert.notEqual(tokenUrl, DEFAULT_OAUTH_TOKEN_URL, 'the stub must not be the real endpoint');
    const result = await callJson(host.baseUrl, '/api/auth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'forwarded-code' }),
    });
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    assert.equal(result.body.data.scope, 'task:task:read offline_access');
    const written = updates.find((entry) => entry.patch.userToken !== undefined);
    assert.ok(written !== undefined, 'the token must be persisted through settings');
    assert.equal(written.patch.userToken, 'u-forwarded');
    assert.equal(written.patch.refreshToken, 'ur-forwarded');
    assert.ok(written.patch.userTokenExpiresAt > Date.now(), 'the expiry must be in the future');
  } finally {
    await host.close();
    await new Promise((done) => tokenServer.close(done));
  }
});

test('POST /api/auth/complete accepts a whole callback URL', async () => {
  const tokenServer = createServer((req, res) => {
    const payload = Buffer.from(JSON.stringify({ code: 0, access_token: 'u-url', expires_in: 7200 }));
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(payload.length) });
    res.end(payload);
  });
  await new Promise((done) => tokenServer.listen(0, '127.0.0.1', done));
  const tokenUrl = `http://127.0.0.1:${tokenServer.address().port}/oauth/v3/token`;
  const host = await start({
    config: { appId: 'cli_stub', appSecret: 'secret', oauthTokenUrl: tokenUrl },
    services: { settings: { installSection: () => {}, update: async () => {} } },
  });
  try {
    const result = await callJson(host.baseUrl, '/api/auth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The user's own service is the callback host: the URL it lands on is
      // what the panel asks the user to paste back.
      body: JSON.stringify({ callbackUrl: 'https://agent-api.example.com/webhooks/feishu/oauth/callback?code=abc123&state=xyz' }),
    });
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
  } finally {
    await host.close();
    await new Promise((done) => tokenServer.close(done));
  }
});

test('an unrecognized route answers ok:false rather than 404', async () => {
  const host = await start();
  try {
    const result = await callJson(host.baseUrl, '/api/nope');
    assert.equal(result.status, 404);
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.message.includes('未知接口'), result.body.error.message);
  } finally {
    await host.close();
  }
});

test('a consent-page denial is reported as a denial, not as a bad paste', async () => {
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's' } });
  try {
    // Declining on the Feishu consent page redirects back with `error` and no
    // `code`; calling that "no authorization code found" hides the real cause.
    const result = await callJson(host.baseUrl, '/api/auth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        callbackUrl: 'https://agent-api.example.com/webhooks/feishu/oauth/callback?error=access_denied&error_description=user%20refused',
      }),
    });
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.message.includes('被拒绝'), result.body.error.message);
    assert.ok(result.body.error.message.includes('user refused'), result.body.error.message);
  } finally {
    await host.close();
  }
});

test('an unrelated paste still reports that no code was found', async () => {
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's' } });
  try {
    const result = await callJson(host.baseUrl, '/api/auth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callbackUrl: '随便一段文字' }),
    });
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.message.includes('没有识别出授权码'), result.body.error.message);
  } finally {
    await host.close();
  }
});

test('GET /api/state reports the configuration facts the panel needs', async () => {
  const host = await start({ config: { appId: 'cli_here', appSecret: 's' } });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.equal(result.body.ok, true);
    assert.equal(result.body.data.configured, true);
    assert.equal(result.body.data.settingsNamespace, 'feishu-plugin');
    assert.ok(result.body.data.configureCommand.includes('apply-settings.mjs'), result.body.data.configureCommand);
    assert.ok(String(result.body.data.settingsPath).includes('settings.yaml'));
    assert.ok(Array.isArray(result.body.data.requiredScopes), 'the panel needs the scope list to show what is missing');
  } finally {
    await host.close();
  }
});

test('state names the scopes a live token is missing', async () => {
  // A token freezes its permissions at authorization time, so this is the fact
  // that tells "the console lacks the permission" from "this token predates
  // it" — the two have different fixes, and the panel must say which.
  const tokenWith = (scopes) => {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ scope: scopes.join(' '), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return `${header}.${payload}.signature-not-verified-here`;
  };
  const host = await start({
    config: {
      appId: 'cli_here',
      appSecret: 's',
      // Pre-seeded so `/api/state` reports what this token holds.
      userToken: tokenWith(['task:task:read', 'offline_access']),
      userTokenExpiresAt: Date.now() + 3_600_000,
    },
  });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.deepEqual(result.body.data.grantedScopes, ['task:task:read', 'offline_access']);
    assert.ok(
      result.body.data.missingScopes.includes('task:task:write'),
      `the write scope must be reported missing: ${JSON.stringify(result.body.data.missingScopes)}`,
    );
    assert.ok(result.body.data.missingScopes.includes('im:chat:readonly'), JSON.stringify(result.body.data.missingScopes));
  } finally {
    await host.close();
  }
});

test('state reports no missing scopes for a fully scoped token', async () => {
  const host = await start({
    config: {
      appId: 'cli_here',
      appSecret: 's',
      userToken: [
        Buffer.from('{}').toString('base64url'),
        Buffer.from(JSON.stringify({ scope: 'task:task:read task:task:write task:tasklist:read im:chat:readonly im:message:readonly im:message.group_msg offline_access' })).toString('base64url'),
        'sig',
      ].join('.'),
      userTokenExpiresAt: Date.now() + 3_600_000,
    },
  });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.deepEqual(result.body.data.missingScopes, [], JSON.stringify(result.body.data.missingScopes));
  } finally {
    await host.close();
  }
});

test('state omits scope facts it cannot read', async () => {
  // An unreadable token must not be reported as "missing everything": the panel
  // would then nag about scopes that may well be granted.
  const host = await start({
    config: { appId: 'cli_here', appSecret: 's', userToken: 'not-a-jwt', userTokenExpiresAt: Date.now() + 3_600_000 },
  });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.equal(result.body.data.grantedScopes, undefined);
    assert.equal(result.body.data.missingScopes, undefined);
  } finally {
    await host.close();
  }
});

test('an unreadable task list is reported as a failure, never as "no tasks"', async () => {
  // The bug this pins: both read paths swallowed their errors, so a failed
  // Feishu call was cached as an empty list and the panel told the user they
  // had no open tasks.
  const feishu = await startFeishuStub((url) => (
    url.pathname.startsWith('/open-apis/task/v2/')
      ? { status: 403, body: { code: 99991679, msg: 'Unauthorized for this probe' } }
      : undefined
  ));
  const host = await start({
    config: {
      appId: 'cli_stub',
      appSecret: 's',
      baseUrl: feishu.origin,
      userToken: [
        Buffer.from('{}').toString('base64url'),
        Buffer.from(JSON.stringify({ scope: 'task:task:read task:tasklist:read' })).toString('base64url'),
        'sig',
      ].join('.'),
      userTokenExpiresAt: Date.now() + 3_600_000,
    },
  });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.ok(Array.isArray(result.body.data.tasks), 'the field must exist for the panel to render');
    assert.equal(result.body.data.tasksLoaded, true, 'a read was attempted');
    assert.ok(
      typeof result.body.data.tasksError === 'string' && result.body.data.tasksError.length > 0,
      `the failure must be reported: ${JSON.stringify(result.body.data.tasksError)}`,
    );
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('a genuinely empty task list is not reported as an error', async () => {
  const feishu = await startFeishuStub((url) => {
    if (url.pathname === '/open-apis/task/v2/tasks') {
      return { body: { code: 0, data: { items: [], has_more: false } } };
    }
    if (url.pathname === '/open-apis/task/v2/tasklists') {
      return { body: { code: 0, data: { items: [], has_more: false } } };
    }
    return undefined;
  });
  const host = await start({
    config: {
      appId: 'cli_stub',
      appSecret: 's',
      baseUrl: feishu.origin,
      userToken: [
        Buffer.from('{}').toString('base64url'),
        Buffer.from(JSON.stringify({ scope: 'task:task:read' })).toString('base64url'),
        'sig',
      ].join('.'),
      userTokenExpiresAt: Date.now() + 3_600_000,
    },
  });
  try {
    const result = await callJson(host.baseUrl, '/api/state');
    assert.deepEqual(result.body.data.tasks, []);
    assert.equal(result.body.data.tasksLoaded, true, 'an empty list that was really read is loaded');
    assert.equal(result.body.data.tasksError, undefined, 'and it is not an error');
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('a failed read is reported again within a short window, then retried', async () => {
  // Two failure modes had to be told apart here. Caching the failure for the
  // whole data TTL would keep a transient outage on screen for a minute after
  // it ended; retrying on every read would hammer a failing upstream. The error
  // therefore has its own short window.
  let attempts = 0;
  let fail = true;
  const feishu = await startFeishuStub((url) => {
    if (url.pathname === '/open-apis/task/v2/tasks') {
      attempts += 1;
      if (fail) return { status: 500, body: { code: 1470500, msg: 'server error' } };
      return { body: { code: 0, data: { items: [{ guid: 'g1', summary: '真的存在', completed_at: '0' }], has_more: false } } };
    }
    if (url.pathname === '/open-apis/task/v2/tasklists') {
      return { body: { code: 0, data: { items: [], has_more: false } } };
    }
    return undefined;
  });
  const host = await start({
    config: {
      appId: 'cli_stub',
      appSecret: 's',
      baseUrl: feishu.origin,
      userToken: [
        Buffer.from('{}').toString('base64url'),
        Buffer.from(JSON.stringify({ scope: 'task:task:read' })).toString('base64url'),
        'sig',
      ].join('.'),
      userTokenExpiresAt: Date.now() + 3_600_000,
    },
  });
  try {
    const first = await callJson(host.baseUrl, '/api/state');
    assert.equal(first.body.data.tasks.length, 0);
    assert.ok(typeof first.body.data.tasksError === 'string', 'the failure is reported');
    const afterFirst = attempts;

    // Immediately after, the remembered failure is reported again rather than
    // hidden behind an empty list — and the upstream is left alone.
    const second = await callJson(host.baseUrl, '/api/state');
    assert.ok(typeof second.body.data.tasksError === 'string', 'the failure is still reported');
    assert.equal(attempts, afterFirst, 'a second read inside the window must not retry');

    // An explicit refresh always retries, which is the user's escape hatch.
    fail = false;
    const refreshed = await callJson(host.baseUrl, '/api/tasks/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(refreshed.body.ok, true, JSON.stringify(refreshed.body));
    assert.equal(refreshed.body.data.items.length, 1, 'the forced read must see the recovered upstream');
    assert.ok(attempts > afterFirst, 'the forced read must have retried');

    const recovered = await callJson(host.baseUrl, '/api/state');
    assert.equal(recovered.body.data.tasks.length, 1, 'and the good result replaces the failure');
    assert.equal(recovered.body.data.tasksError, undefined, 'the error clears on success');
  } finally {
    await host.close();
    await feishu.close();
  }
});

test('the read decision ages a remembered failure out instead of keeping it', () => {
  // The three answers a plain read can give, at the boundaries. The failure that
  // started all of this was a written-off read being served forever: the state
  // route refused to read while an error was remembered, and nothing expired it.
  const now = 1_000_000;
  const loaded = { tasks: [], tasksSource: 'my_tasks', tasksAt: now - 1_000 };
  assert.equal(planTaskRead(loaded, now), 'cache', 'a fresh list is the answer');
  assert.equal(planTaskRead({}, now), 'read', 'a cold cache must be filled');

  const failed = { tasksError: 'boom', tasksErrorAt: now - 1_000 };
  assert.equal(planTaskRead(failed, now), 'remember', 'a fresh failure is re-reported, not retried');
  assert.equal(
    planTaskRead({ tasksError: 'boom', tasksErrorAt: now - TASKS_ERROR_TTL_MS }, now),
    'read',
    'an aged-out failure must be retried',
  );

  // A loaded list that has outlived its TTL is re-read; so is one with a failure
  // remembered long ago. A list whose TTL passed but whose failure is fresh is
  // still served, with the failure attached.
  assert.equal(planTaskRead({ ...loaded, tasksAt: now - TASKS_TTL_MS }, now), 'read');
  assert.equal(
    planTaskRead({ tasks: [], tasksSource: 'my_tasks', tasksAt: now - TASKS_TTL_MS, tasksError: 'boom', tasksErrorAt: now - 1_000 }, now),
    'remember',
  );
  assert.equal(
    planTaskRead({ tasks: [], tasksSource: 'my_tasks', tasksAt: now - 1_000, tasksError: 'boom', tasksErrorAt: now - 1_000 }, now),
    'cache',
    'a fresh list wins over an error it already carries',
  );
});

test('a settings source installed after mount is what every read uses', async () => {
  // The bug this pins: `apply()` reads its config through a binding that the
  // settings provider *replaces* once it resolves the stored section. The route
  // and read layers live in their own modules, so handing them the getter's
  // value at mount time froze them on the composition entry — the panel then
  // reported "not configured" forever, for a user whose settings.yaml was
  // perfectly well configured.
  const host = await start({ config: { appId: '', appSecret: '' } });
  try {
    const before = await callJson(host.baseUrl, '/api/state');
    assert.equal(before.body.data.configured, false, 'the composition entry has no credentials');

    // What the provider calls once it has resolved the stored section.
    host.setSettingsSource(() => ({
      appId: 'cli_stub',
      appSecret: 's',
      baseUrl: 'https://open.larksuite.com',
      maxMessages: 500,
      toolsEnabled: false,
    }));

    const after = await callJson(host.baseUrl, '/api/state');
    assert.equal(after.body.data.configured, true, 'the plugin must see the source installed after mount');
    assert.equal(after.body.data.baseUrl, 'https://open.larksuite.com', 'and read through it, not through the entry');
  } finally {
    await host.close();
  }
});

test('the authorize state is prefixed so a shared callback can route it', async () => {
  const host = await start({ config: { appId: 'cli_stub', appSecret: 's' } });
  try {
    const result = await callJson(host.baseUrl, '/api/auth/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(result.body.ok, true, JSON.stringify(result.body));
    const state = new URL(result.body.data.url).searchParams.get('state');
    assert.ok(state.startsWith('dsh-feishu-'), `state must carry the marker prefix: ${state}`);
    assert.ok(state.length > 'dsh-feishu-'.length, 'a prefix alone is not a nonce');
  } finally {
    await host.close();
  }
});

export { cases };
