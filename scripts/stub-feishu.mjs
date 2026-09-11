/**
 * A fake Feishu open-platform API, for driving the panel without a real tenant.
 *
 * The browser check (`panel-check.mjs --ui`) needs a configured plugin, and a
 * real tenant is the wrong thing to point it at: the check would read and write
 * somebody's actual tasks. This server answers just the endpoints the plugin
 * uses, with the envelopes Feishu uses, so the panel renders real task rows and
 * its 「完成」button really performs a write — against a throwaway list.
 *
 * Pair it with an isolated home whose settings point at it:
 *
 *   node scripts/stub-feishu.mjs 3098 &
 *   # .dsh-test/settings.yaml
 *   # feishu-plugin:
 *   #   appId: cli_stub
 *   #   appSecret: stub
 *   #   baseUrl: http://127.0.0.1:3098
 *
 * Usage: `node scripts/stub-feishu.mjs [port]`
 *
 * @module dsh-feishu-plugin/scripts/stub-feishu
 */

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3098);

/** Two overdue-free tasks and one overdue one, so every row style is exercised. */
const tasks = [
  {
    guid: 'stub-task-1',
    summary: '写周报：本周飞书插件进展',
    description: '把「加入输入框」和「完成」两条链路各跑一遍',
    completed_at: '0',
    due: { timestamp: String(Date.now() + 36 * 3600_000), is_all_day: false },
    tasklists: [{ tasklist_guid: 'stub-list-1' }],
  },
  {
    guid: 'stub-task-2',
    summary: 'review 群聊总结的提示词',
    completed_at: '0',
    due: { timestamp: String(Date.now() - 26 * 3600_000), is_all_day: true },
    tasklists: [{ tasklist_guid: 'stub-list-1' }],
  },
  { guid: 'stub-task-3', summary: '没有截止时间也没有清单的任务', completed_at: '0' },
];

/** Chats the bot "is in". */
const chats = [
  { chat_id: 'oc_stub_1', name: 'DragonBowl 工作组', description: '插件开发' },
  { chat_id: 'oc_stub_2', name: 'Snapia 工作组' },
];

/** Members of the stub chats, so the chat view can resolve names instead of ids. */
const members = [
  { member_id: 'ou_stub_1', name: '徐屹寒' },
  { member_id: 'ou_stub_2', name: '张晓' },
  { member_id: 'ou_stub_me', name: '我' },
];

/**
 * A conversation that exercises every bubble shape at once: a mention, an
 * ordinary reply, a recalled message, an image, a file, and a quote.
 *
 * Newest first, exactly as the API pages it — the client reverses it back into
 * chronological order.
 */
const now = Date.now();
const messages = [
  {
    message_id: 'om_stub_6',
    msg_type: 'file',
    create_time: String(now - 60_000),
    sender: { id: 'ou_stub_2', sender_type: 'user' },
    body: { content: JSON.stringify({ file_key: 'file_stub_1', file_name: '周会纪要.pdf' }) },
  },
  {
    message_id: 'om_stub_5',
    msg_type: 'image',
    create_time: String(now - 120_000),
    sender: { id: 'ou_stub_2', sender_type: 'user' },
    body: { content: JSON.stringify({ image_key: 'img_stub_1' }) },
  },
  {
    message_id: 'om_stub_4',
    msg_type: 'text',
    // `parent_id` points at the mention below, so the quote block has something
    // to show without a second request.
    parent_id: 'om_stub_3',
    create_time: String(now - 180_000),
    sender: { id: 'ou_stub_me', sender_type: 'user' },
    body: { content: JSON.stringify({ text: '好，我来写周报' }) },
  },
  {
    message_id: 'om_stub_3',
    msg_type: 'text',
    create_time: String(now - 240_000),
    sender: { id: 'ou_stub_1', sender_type: 'user' },
    mentions: [{ key: '@_user_1', id: 'ou_stub_me', name: '我' }],
    body: { content: JSON.stringify({ text: '@_user_1 这周的周报你写？记得周五前发出来' }) },
  },
  {
    message_id: 'om_stub_2',
    msg_type: 'text',
    deleted: true,
    create_time: String(now - 300_000),
    sender: { id: 'ou_stub_2', sender_type: 'user' },
    body: { content: JSON.stringify({ text: 'This message was recalled' }) },
  },
  {
    message_id: 'om_stub_1',
    msg_type: 'text',
    create_time: String(now - 26 * 3600_000),
    sender: { id: 'ou_stub_2', sender_type: 'user' },
    body: { content: JSON.stringify({ text: '这周的周报谁写？' }) },
  },
];

/** A 1×1 PNG, so the media route has real bytes to relay. */
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** Answer one request with a Feishu-shaped envelope. */
function send(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const path = url.pathname;
  console.log(`${req.method} ${path}${url.search}`);
  if (req.method === 'POST' && path === '/open-apis/auth/v3/tenant_access_token/internal') {
    send(res, { code: 0, msg: 'ok', tenant_access_token: 't-stub', expire: 7200 });
    return;
  }
  if (req.method === 'GET' && path === '/open-apis/im/v1/chats') {
    send(res, { code: 0, msg: 'ok', data: { items: chats, has_more: false, page_token: '' } });
    return;
  }
  if (req.method === 'GET' && path === '/open-apis/im/v1/messages') {
    send(res, { code: 0, msg: 'ok', data: { items: messages, has_more: false, page_token: '' } });
    return;
  }
  // Member names: the chat view resolves sender ids with these, so a stub
  // without them would render `ou_…` instead of people. `STUB_NO_MEMBERS=1`
  // makes the endpoint fail the way a non-member operator sees it (232011), so
  // the unnamed-sender path can be inspected by hand.
  const membersOf = /^\/open-apis\/im\/v1\/chats\/([^/]+)\/members$/.exec(path);
  if (req.method === 'GET' && membersOf !== null) {
    if (process.env.STUB_NO_MEMBERS === '1') {
      send(res, { code: 232011, msg: 'operator not in chat', data: {} });
      return;
    }
    send(res, { code: 0, msg: 'ok', data: { items: members, has_more: false, member_total: members.length } });
    return;
  }
  // Message resources: real bytes, so an image bubble actually shows something.
  const resourceOf = /^\/open-apis\/im\/v1\/messages\/([^/]+)\/resources\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && resourceOf !== null) {
    const bytes = STUB_PNG;
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(bytes.length), connection: 'close' });
    res.end(bytes);
    return;
  }
  // The profile of the authorized user; the plugin asks for it right after an
  // authorization so it can tell which messages are the user's own.
  if (req.method === 'GET' && path === '/open-apis/authen/v1/user_info') {
    send(res, { code: 0, msg: 'ok', data: { name: '我', open_id: 'ou_stub_me', avatar_url: '' } });
    return;
  }
  if (req.method === 'GET' && path === '/open-apis/task/v2/tasks') {
    // The plugin asks for open tasks only; a completed one must not come back,
    // which is what makes the row disappear after a write.
    const open = url.searchParams.get('completed') === 'false'
      ? tasks.filter((task) => task.completed_at === '0' || task.completed_at.length === 0)
      : tasks;
    send(res, { code: 0, msg: 'ok', data: { items: open, has_more: false } });
    return;
  }
  if (req.method === 'GET' && path === '/open-apis/task/v2/tasklists') {
    send(res, { code: 0, msg: 'ok', data: { items: [{ guid: 'stub-list-1', name: '团队清单' }], has_more: false } });
    return;
  }
  if (req.method === 'GET' && path === '/open-apis/task/v2/tasklists/stub-list-1/tasks') {
    send(res, { code: 0, msg: 'ok', data: { items: tasks, has_more: false } });
    return;
  }
  const patch = /^\/open-apis\/task\/v2\/tasks\/([^/]+)$/.exec(path);
  if (patch !== null && req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      const guid = decodeURIComponent(patch[1]);
      const target = tasks.find((task) => task.guid === guid);
      if (target !== undefined) target.completed_at = parsed?.task?.completed_at ?? '0';
      console.log(`  → ${guid} completed_at=${target?.completed_at ?? '?'}`);
      send(res, { code: 0, msg: 'ok', data: {} });
    });
    return;
  }
  send(res, { code: 99991663, msg: `stub: unhandled ${req.method} ${path}` }, 404);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`stub Feishu API on http://127.0.0.1:${port}（${tasks.length} 条任务，${chats.length} 个群）`);
});
