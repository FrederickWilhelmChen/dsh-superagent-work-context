/**
 * The HTTP harness the route cases drive the plugin through.
 *
 * A real `node:http` server wraps the handler the plugin registered, so the
 * cases exercise URLs and bodies rather than calling internals, and a second
 * stub stands in for the Feishu open API so nothing leaves the machine.
 *
 * @module dsh-feishu-plugin/test/routes-harness
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { API_PREFIX, Config, apply } from '../lib/index.js';

export async function start(options = {}) {
  const config = { ...Config({}), ...options.config };
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const routes = [];
  /**
   * What the plugin handed the settings provider when it installed its section.
   *
   * This is the seam the provider uses to replace the plugin's config source
   * *after* mount, so a case can exercise the real sequence: mount with the
   * composition entry, then hand over the stored section.
   * @type {{ owner: any, ns: string, schema: any, entry: any, hooks: any } | undefined}
   */
  let installed;
  const settingsStub = options.services?.settings ?? {
    installSection: (owner, ns, schema, entry, hooks) => {
      installed = { owner, ns, schema, entry, hooks };
    },
    update: async () => {},
  };
  const ctx = {
    // A real Cordis context exposes services as properties as well as through
    // `get`, and the plugin installs its settings section off `ctx.settings`:
    // without this property the call was silently swallowed by the plugin's own
    // try/catch and no case ever exercised the install path.
    settings: settingsStub,
    logger: () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} }),
    get: (name) => (name === 'settings' ? settingsStub : options.services?.[name]),
    inject: (names, callback) => {
      const available = names.filter((name) => ctx.get(name) !== undefined);
      if (available.length > 0) callback(ctx);
    },
    effect: (execute) => execute(),
    webServer: {
      register: (route) => {
        routes.push(route);
        return () => {};
      },
    },
    ...options.ctx,
  };
  apply(ctx, config);
  assert.equal(routes.length, 1, 'the plugin must register exactly one route');
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, API_PREFIX);

  // A real HTTP server over the registered handler, so the cases exercise URLs
  // and bodies rather than calling internals.
  const server = createServer((req, res) => {
    // Force the connection closed: every case binds an ephemeral port that the
    // OS recycles for the next case, and a pooled keep-alive socket to a closed
    // server surfaces as an unrelated case failing with a bare fetch error.
    // Node merges headers set here with the handler's own.
    res.setHeader('connection', 'close');
    calls.push(req.url);
    void routes[0].handler(req, res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    ctx,
    /** Install a settings source the way the provider does, after mount. */
    setSettingsSource: (source) => {
      assert.ok(installed !== undefined, 'the plugin must install its settings section');
      installed.hooks.setSource(source);
      installed.hooks.onChange();
    },
    installedSettings: () => installed,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Call one route and parse the JSON envelope. */
export async function callJson(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${API_PREFIX}${path}`, init);
  return { status: response.status, body: await response.json(), contentType: response.headers.get('content-type') };
}

export async function startFeishuStub(handler) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const reply = (status, body) => {
      const payload = Buffer.from(JSON.stringify(body));
      // `connection: close` keeps undici from pooling a socket to this stub: the
      // OS recycles the ephemeral port for the next case's server, and a reused
      // socket to a closed server surfaces as a bare "fetch failed" later.
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(payload.length), connection: 'close' });
      res.end(payload);
    };
    if (url.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      reply(200, { code: 0, tenant_access_token: 't-stub', expire: 7200 });
      return;
    }
    const answer = handler(url);
    if (answer === undefined) {
      reply(404, { code: 404, msg: `no stub answer for ${url.pathname}` });
      return;
    }
    // A binary answer is what makes the resource relay testable: that route
    // hands the browser bytes, not an envelope.
    if (answer.raw !== undefined) {
      res.writeHead(answer.status ?? 200, {
        'content-type': answer.contentType ?? 'application/octet-stream',
        'content-length': String(answer.raw.length),
        connection: 'close',
      });
      res.end(answer.raw);
      return;
    }
    reply(answer.status ?? 200, answer.body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

export function chatStubHandler(options = {}) {
  const messages = options.messages ?? [
    {
      message_id: 'om_1',
      msg_type: 'text',
      create_time: '1760000000000',
      sender: { id: 'ou_zhang', sender_type: 'user' },
      mentions: [{ key: '@_user_9', id: 'ou_li', name: '李四' }],
      body: { content: JSON.stringify({ text: '@_user_9 看下这个' }) },
    },
    {
      message_id: 'om_2',
      msg_type: 'image',
      create_time: '1760000060000',
      sender: { id: 'ou_li', sender_type: 'user' },
      body: { content: JSON.stringify({ image_key: 'img_v2_x' }) },
    },
    {
      message_id: 'om_3',
      msg_type: 'text',
      deleted: true,
      create_time: '1760000120000',
      sender: { id: 'ou_li', sender_type: 'user' },
      body: { content: JSON.stringify({ text: 'This message was recalled' }) },
    },
  ];
  return (url) => {
    if (url.pathname === '/open-apis/im/v1/chats') {
      return { body: { code: 0, data: { items: [{ chat_id: 'oc_1', name: 'DragonBowl 工作组', avatar: 'https://example.com/g.png' }], has_more: false } } };
    }
    if (url.pathname === '/open-apis/im/v1/messages') {
      // The real endpoint pages newest-first and the client reverses the pages
      // back into chronological order, so the stub has to answer in that order
      // or the case would assert on an order the API never produces.
      return { body: { code: 0, data: { items: [...messages].reverse(), has_more: false } } };
    }
    if (url.pathname === '/open-apis/im/v1/chats/oc_1/members') {
      if (options.memberFailure !== undefined) {
        return { status: 400, body: { code: options.memberFailure, msg: 'operator can NOT be out of the chat' } };
      }
      return { body: { code: 0, data: { items: [{ member_id: 'ou_zhang', name: '张三' }, { member_id: 'ou_li', name: '李四' }], has_more: false } } };
    }
    return undefined;
  };
}
