/**
 * Cases for the model answer parser and the streaming collector.
 *
 * The parser is the seam where an LLM's output format meets a strict UI, so
 * every degradation path is pinned: a fenced block, a preamble, plain prose,
 * and a well-formed answer.
 *
 * @module dsh-feishu-plugin/test/summary
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import { buildSummaryPrompt, collectStreamText, normalizeActionItem, parseSummary } from '../lib/summary.mjs';

const { test, cases } = suite('summary');

test('buildSummaryPrompt carries the chat name, count and transcript', () => {
  const prompt = buildSummaryPrompt({ chatName: '产品群', transcript: '[2024-01-01 10:00] 张三: 你好', messageCount: 1, truncated: true });
  assert.ok(prompt.includes('群名称：产品群'), prompt);
  assert.ok(prompt.includes('参与消息数：1 条（已按长度截断'), prompt);
  assert.ok(prompt.includes('张三: 你好'), prompt);
});

test('a well-formed answer round-trips', () => {
  const parsed = parseSummary(JSON.stringify({
    summary: '讨论了发版时间',
    keyPoints: ['周四发版', ''],
    actionItems: [
      { title: '准备发版说明', owner: '张三', due: '周四', priority: 'high', confidence: 0.9, evidence: '张三：我来写' },
      { title: '', owner: '李四' },
    ],
  }));
  assert.equal(parsed.summary, '讨论了发版时间');
  assert.deepEqual(parsed.keyPoints, ['周四发版']);
  assert.equal(parsed.actionItems.length, 1, 'an item without a title is dropped');
  assert.equal(parsed.actionItems[0].owner, '张三');
  assert.equal(parsed.actionItems[0].priority, 'high');
  assert.equal(parsed.actionItems[0].confidence, 0.9);
  assert.equal(parsed.warning, undefined);
});

test('a fenced answer is unwrapped', () => {
  const parsed = parseSummary('```json\n{"summary":"好的","keyPoints":[],"actionItems":[]}\n```');
  assert.equal(parsed.summary, '好的');
  assert.equal(parsed.warning, undefined);
});

test('a preamble before the JSON is tolerated', () => {
  const parsed = parseSummary('好的，以下是结果：\n{"summary":"结论","keyPoints":["a"],"actionItems":[]}\n希望有帮助。');
  assert.equal(parsed.summary, '结论');
  assert.deepEqual(parsed.keyPoints, ['a']);
});

test('plain prose degrades to the raw text with a warning', () => {
  const parsed = parseSummary('这个群里大家主要在讨论发版时间，没有明确的待办。');
  assert.ok(parsed.summary.includes('发版时间'));
  assert.deepEqual(parsed.actionItems, []);
  assert.ok(typeof parsed.warning === 'string' && parsed.warning.length > 0);
});

test('truncated JSON degrades instead of throwing', () => {
  const parsed = parseSummary('{"summary":"未完成的输出","keyPoints":[');
  assert.ok(parsed.summary.length > 0);
  assert.ok(typeof parsed.warning === 'string');
});

test('an empty answer reports it', () => {
  const parsed = parseSummary('   ');
  assert.equal(parsed.summary, '');
  assert.ok(parsed.warning.includes('没有返回任何内容'));
});

test('keyPoints alone still produce a summary', () => {
  const parsed = parseSummary(JSON.stringify({ keyPoints: ['a', 'b'], actionItems: [] }));
  assert.equal(parsed.summary, 'a；b');
  assert.equal(parsed.warning, undefined);
});

test('normalizeActionItem clamps confidence and defaults priority', () => {
  assert.equal(normalizeActionItem({ title: 'x', confidence: 90 }, 0).confidence, 0.9);
  assert.equal(normalizeActionItem({ title: 'x', confidence: -5 }, 0).confidence, 0);
  assert.equal(normalizeActionItem({ title: 'x' }, 0).priority, 'medium');
  assert.equal(normalizeActionItem({ summary: '来自 summary 字段' }, 0).title, '来自 summary 字段');
  assert.equal(normalizeActionItem({ owner: '张三' }, 0), undefined);
  assert.equal(normalizeActionItem(null, 0), undefined);
});

test('normalizeActionItem truncates an over-long evidence quote', () => {
  const item = normalizeActionItem({ title: 'x', evidence: 'y'.repeat(500) }, 0);
  assert.equal(item.evidence.length, 300);
});

test('collectStreamText joins text deltas and reports the finish reason', async () => {
  const stream = (async function* generate() {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: '{"summary"' };
    yield { type: 'reasoning-delta', index: 0, text: 'ignored' };
    yield { type: 'text-delta', index: 0, text: ':"ok"}' };
    yield { type: 'finish', reason: 'stop' };
  })();
  const result = await collectStreamText(stream);
  assert.equal(result.text, '{"summary":"ok"}');
  assert.equal(result.finishReason, 'stop');
});

test('collectStreamText tolerates an empty stream', async () => {
  const result = await collectStreamText((async function* generate() {})());
  assert.equal(result.text, '');
  assert.equal(result.finishReason, undefined);
});

export { cases };
