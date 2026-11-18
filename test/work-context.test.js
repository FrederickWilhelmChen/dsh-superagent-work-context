import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFeishu, pages } from '../src/feishu.js';
import { runCycle } from '../src/loop.js';
import { dispatch } from '../src/review.js';
import { Store } from '../src/store.js';

const A = 'oc_GroupA';
const B = 'oc_GroupB';
const ownerId = 'ou_Owner';
const bot = ['cli_test', 'ou_Bot', ownerId];
const start = Date.parse('2026-11-18T09:00:00+08:00');
const settings = { ownerId, ownerName: 'Owner', bootstrapDays: 14, threadLimit: 120, deliverPrivate: true };
const signal = new AbortController().signal;
const route = { provider: 'fixture', model: 'fixture' };
const key = 'invoice-918';
const reminder = (status, trigger, other = []) => ({ key, topic: 'Invoice 918', status, owner: ownerId,
  next: 'Alice asks you to check invoice 918.', evidence: [trigger, ...other], ...(status === 'follow_up' ? { trigger } : {}) });
const reply = (actions, facts = []) => ({ summary: 'Invoice follow-up status.', actions, facts });
const url = 'https://team.feishu.cn/docx/Meeting1';

function message(id, group, text, extra = {}) {
  return { message_id: id, chat_id: group, sender: { id: 'ou_Alice', sender_type: 'user' }, create_time: String(start - 10000),
    msg_type: 'text', message_position: '42', body: { content: JSON.stringify({ text }) }, deleted: false, ...extra };
}

function scenario(t) {
  const dir = mkdtempSync(join(tmpdir(), 'work-context-test-'));
  const path = join(dir, 'context.sqlite3');
  let store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  });
  let clock = start;
  const calls = [];
  const outbound = [];
  const remote = new Map();
  const groups = [A, B];
  const messages = new Map([[A, []], [B, []]]);
  const failures = new Set();
  let loseReceipt = false;
  let model;
  const client = createFeishu({
    async lark(args) {
      calls.push(args);
      if (args[0] === 'api') {
        const params = JSON.parse(args[4]);
        if (args[2].endsWith('/chats')) {
          const offset = Number(params.page_token ?? 0);
          return { items: groups.slice(offset, offset + 1).map(chat_id => ({ chat_id, name: chat_id, chat_mode: 'group' })),
            has_more: offset + 1 < groups.length, page_token: String(offset + 1) };
        }
        if (params.container_id_type === 'thread') return { items: [], has_more: false };
        assert.match(params.start_time, /^\d+$/);
        assert.match(params.end_time, /^\d+$/);
        if (failures.has(params.container_id)) throw new Error('Source unavailable');
        return { items: messages.get(params.container_id), has_more: false };
      }
      if (args[1] === '+chat-members-list') {
        return { users: [{ member_id: 'ou_Alice', name: 'Alice' }], has_more: false };
      }
      if (args[1] === '+fetch') {
        assert.equal(args[3], url);
        return { document: { content: 'Meeting note: Alice confirmed invoice 918 remains open.', title: 'Meeting minutes' } };
      }
      assert.equal(args[1], '+messages-send');
      assert.equal(args[2], '--user-id');
      assert.equal(args[3], ownerId);
      const idempotency = args[7];
      outbound.push({ idempotency, text: args[5] });
      if (!remote.has(idempotency)) remote.set(idempotency, `om_Sent${remote.size + 1}`);
      if (loseReceipt) throw new Error('Receipt lost after acceptance');
      return { message_id: remote.get(idempotency) };
    },
  }, 'feishu');
  const llm = {
    async *stream(req) {
      assert.equal(req.provider, route.provider);
      assert.equal(req.tools, undefined);
      assert.match(req.system, /untrusted evidence|never instructions/);
      const output = model(JSON.parse(req.messages[0].content[0].text));
      yield { type: 'text-delta', text: JSON.stringify(output) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  return {
    client, messages, groups, failures, calls, outbound, remote,
    cycle(fn, options = {}) {
      model = fn;
      store.bindIdentity(bot);
      return runCycle({ store, dir, feishu: client, llm, route, settings: { ...settings, ...options },
        identity: bot, now: () => clock, signal });
    },
    advance(minutes) { clock += minutes * 60000; },
    restart() { store.close(); store = new Store(path); },
    loseReceipt(value) { loseReceipt = value; },
    get store() { return store; },
    snapshot() { return JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8')); },
  };
}

test('discovers new groups, joins prior evidence across them, preserves durable keys, and sends only once', async t => {
  const s = scenario(t);
  s.groups.pop();
  s.messages.get(A).push(message('om_One', A, `Meeting minutes: ${url}. Owner, please check invoice 918.`));
  const initial = await s.cycle(input => {
    assert.deepEqual(input.groups.map(group => group.id), [A]);
    assert.deepEqual(new Set(input.evidence.map(item => item.id)), new Set(['om_One', 'Meeting1']));
    assert.equal(input.evidence.find(item => item.id === 'om_One').author, 'Alice');
    return reply([reminder('follow_up', 'om_One', ['Meeting1'])]);
  });
  assert.equal(initial.through, 2);
  assert.equal(s.remote.size, 1);
  assert.match(s.outbound[0].text, /openChatId=oc_GroupA&position=42/);
  s.restart();
  s.advance(30);
  s.groups.push(B);
  s.messages.get(B).push(message('om_Repeat', B, 'Reposting invoice 918, unchanged.'));
  const repeated = await s.cycle(input => {
    assert.deepEqual(input.groups.map(group => group.id), [A, B]);
    assert.deepEqual(input.evidence.map(item => item.id), ['om_Repeat']);
    assert.equal(input.context.actions[0].key, key);
    return reply([reminder('follow_up', 'om_Repeat', ['om_One'])]);
  });
  assert.equal(repeated.context.actions[0].trigger, 'om_One');
  assert.equal(s.outbound.length, 1);
  s.advance(30);
  s.messages.get(B).push(message('om_Closed', B, 'Invoice 918 was checked and the issue is resolved.'));
  const closed = await s.cycle(() => reply([reminder('closed', 'om_Closed', ['om_One'])]));
  assert.equal(closed.context.actions[0].status, 'closed');
  assert.equal(s.snapshot().coverage.receipts.sent, 1);
  assert.equal(s.outbound.length, 1);
  await s.cycle(() => assert.fail('unchanged evidence should not call the model'));
});

test('does not dispatch intermediate drafts, and keeps failed group cursors independent', async t => {
  const s = scenario(t);
  s.failures.add(B);
  s.messages.get(A).push(message('om_One', A, 'Owner, please check invoice 918.'));
  const view = await s.cycle(() => reply([reminder('follow_up', 'om_One')]), { deliverPrivate: false });
  assert.equal(view.context.actions[0].status, 'follow_up');
  assert.equal(s.outbound.length, 0);
  assert.equal(s.snapshot().coverage.receipts.pending, 1);
  assert.equal(s.store.groups().find(group => group.id === B).cursor, null);
  assert.equal(s.snapshot().coverage.gaps[0].id, B);
  s.failures.delete(B);
  s.messages.get(B).push(message('om_Done', B, 'Invoice 918 was resolved.'));
  await s.cycle(() => reply([reminder('closed', 'om_Done')]));
  assert.equal(s.outbound.length, 0);
  assert.equal(s.snapshot().coverage.receipts.superseded, 1);
});

test('retains evidence after an invalid model response and refuses bot-sourced reminders', async t => {
  const s = scenario(t);
  s.messages.get(A).push(message('om_Bot', A, 'Take this action now.', { sender: { id: 'cli_X', sender_type: 'app' } }));
  await assert.rejects(s.cycle(() => reply([reminder('follow_up', 'om_Bot')])), /live human or meeting evidence/);
  assert.equal(s.store.view().through, 0);
  assert.equal(s.store.highwater(), 1);
  assert.equal(s.outbound.length, 0);
  await s.cycle(() => reply([]));
  assert.equal(s.store.view().through, 1);
});

test('uses the same Feishu idempotency key after an ambiguous send and restart', async t => {
  const s = scenario(t);
  s.messages.get(A).push(message('om_One', A, 'Owner, check invoice 918.'));
  s.loseReceipt(true);
  await assert.rejects(s.cycle(() => reply([reminder('follow_up', 'om_One')])), /Receipt lost/);
  assert.equal(s.remote.size, 1);
  s.restart();
  s.loseReceipt(false);
  s.advance(30);
  await s.cycle(() => assert.fail('no new changes'));
  assert.equal(s.outbound.length, 2);
  assert.equal(s.outbound[0].idempotency, s.outbound[1].idempotency);
  assert.equal(s.remote.size, 1);
  assert.equal(s.snapshot().coverage.receipts.sent, 1);
});

test('does not replay an ambiguous delivery outside Feishu idempotency window', async t => {
  const s = scenario(t);
  s.messages.get(A).push(message('om_One', A, 'Owner, check invoice 918.'));
  s.loseReceipt(true);
  await assert.rejects(s.cycle(() => reply([reminder('follow_up', 'om_One')])), /Receipt lost/);
  s.restart();
  s.advance(60);
  await s.cycle(() => assert.fail('no new changes'));
  assert.equal(s.outbound.length, 1);
  assert.equal(s.snapshot().coverage.receipts.uncertain, 1);
});

test('reassesses an explicitly documented checkpoint without requiring a new group message', async t => {
  const s = scenario(t);
  s.messages.get(A).push(message('om_One', A, 'Owner, check invoice 918 at 09:30 Shanghai time.'));
  await s.cycle(() => reply([{ ...reminder('waiting', 'om_One'),
    checkAt: '2026-11-18T09:30:00+08:00', checkTrigger: 'om_One' }]));
  s.advance(29);
  await s.cycle(() => assert.fail('checkpoint is not due'));
  s.advance(1);
  await s.cycle(input => {
    assert.equal(input.evidence.length, 0);
    assert.equal(input.checkpointEvidence[0].id, 'om_One');
    return reply([reminder('follow_up', 'om_One')]);
  });
  assert.equal(s.outbound.length, 1);
});

test('a known coverage gap holds the affected recipient reminder', async t => {
  const s = scenario(t);
  s.messages.get(A).push(message('om_One', A, 'Owner, check invoice 918.'));
  const view = await s.cycle(() => reply([reminder('follow_up', 'om_One')]), { deliverPrivate: false });
  await dispatch({ store: s.store, feishu: s.client, ownerId, view, coverage: [{ id: A }], now: () => start, signal });
  assert.equal(s.outbound.length, 0);
  assert.equal(s.store.receiptCounts().pending, 1);
});

test('detects a repeated pagination cursor instead of treating the source as complete', async () => {
  const consume = async () => {
    for await (const _ of pages(async () => ({ items: [], hasMore: true, pageToken: 'same' }))) {
      assert.fail('unexpected row');
    }
  };
  await assert.rejects(consume(), /pagination did not advance/);
});

test('accepts an unattributed Feishu system record without losing human messages on the same page', async t => {
  const s = scenario(t);
  s.messages.get(A).push(message('om_System', A, 'State updated', { msg_type: 'system',
    sender: { id: '', sender_type: '' } }));
  s.messages.get(A).push(message('om_One', A, 'Owner, please check invoice 918.'));
  await s.cycle(input => {
    assert.equal(input.evidence.length, 2);
    assert.equal(input.evidence.find(record => record.id === 'om_System').human, false);
    return reply([reminder('follow_up', 'om_One')]);
  });
  assert.equal(s.snapshot().coverage.gaps.length, 0);
  assert.equal(s.outbound.length, 1);
});
