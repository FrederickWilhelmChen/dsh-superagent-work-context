/**
 * The local stand-in for the Feishu open API.
 *
 * The client's expensive failure modes are all about paging, credential
 * selection, and error normalization — behavior a pure function cannot cover.
 * A local `node:http` server stands in for `open.feishu.cn`, so the code path
 * under test is the real one: real fetch, real URLs, real pagination loop.
 *
 * @module dsh-feishu-plugin/test/feishu-client-harness
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFeishuClient } from '../lib/feishu.mjs';

export const USER_TOKEN = 'u-good-token';

/** Tenant token the stub hands out. */
export const TENANT_TOKEN = 't-stub-tenant-token';

/**
 * Start a stub open API.
 *
 * The stub serves the two credential endpoints itself and delegates everything
 * else to `handler`. A handler may return `undefined` to mean "this stub has
 * no such endpoint", and throwing inside one is reported as a 500 rather than
 * hanging the request — a silent hang is the hardest stub failure to read.
 *
 * @param {(req: import('node:http').IncomingMessage, url: URL) => { status?: number, body: any } | undefined} handler - per-request handler.
 * @returns {Promise<{ baseUrl: string, calls: Array<{ method: string, path: string, query: string, auth: string | undefined, body: any }>, close: () => Promise<void> }>} running stub.
 */
export function startStub(handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const auth = req.headers.authorization;
    calls.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
      auth,
      body: raw.length === 0 ? undefined : JSON.parse(raw),
    });
    const reply = (status, body) => {
      const payload = Buffer.from(JSON.stringify(body));
      // `connection: close` keeps undici from pooling a socket to this stub: the
      // OS recycles the ephemeral port for the next case's server, and a reused
      // socket to a closed server surfaces as a bare "fetch failed" in whichever
      // case happens to run next.
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(payload.length), connection: 'close' });
      res.end(payload);
    };
    // Credential endpoints are the stub's own business; everything else is the
    // case's handler.
    if (url.pathname === '/open-apis/auth/v3/tenant_access_token/internal') {
      reply(200, { code: 0, msg: 'ok', tenant_access_token: TENANT_TOKEN, expire: 7200 });
      return;
    }
    // The OAuth endpoint lives on `accounts.feishu.cn`, so the stub answers it
    // by pathname alone — that is what proves the client uses the documented
    // absolute token URL rather than the configured API origin.
    if (url.pathname === '/oauth/v3/token') {
      const body = raw.length === 0 ? {} : JSON.parse(raw);
      if (body.grant_type === 'authorization_code') {
        reply(200, { code: 0, access_token: USER_TOKEN, refresh_token: 'ur-refresh-1', expires_in: 7200, refresh_expires_in: 2591940, scope: 'task:task:read' });
      } else {
        reply(200, { code: 0, access_token: 'u-refreshed', refresh_token: 'ur-refresh-2', expires_in: 7200 });
      }
      return;
    }
    let answer;
    try {
      answer = handler === undefined ? undefined : handler(req, url);
    } catch (error) {
      reply(500, { code: -1, msg: `stub handler threw: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (answer === undefined) {
      reply(404, { code: 404, msg: 'not found' });
      return;
    }
    reply(answer.status ?? 200, answer.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * Build a client pointed at a stub.
 * @param {any} stub - running stub.
 * @param {object} [overrides] - config overrides.
 * @returns {any} the client.
 */
export function clientFor(stub, overrides = {}) {
  return createFeishuClient({
    getConfig: () => ({
      appId: 'cli_stub',
      appSecret: 'secret',
      baseUrl: stub.baseUrl,
      // The OAuth token endpoint is configured separately because it lives on
      // a different host; pointing it at the stub is what makes the exchange
      // flow testable without reaching accounts.feishu.cn.
      oauthTokenUrl: `${stub.baseUrl}/oauth/v3/token`,
      ...overrides,
    }),
  });
}
