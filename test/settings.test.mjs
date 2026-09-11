/**
 * Cases for the settings-document writer.
 *
 * This script edits a file the user owns and shares with every other plugin, so
 * the only thing that matters is that it touches exactly one section. Each case
 * below is a way a naive re-serialization would damage that file.
 *
 * @module dsh-feishu-plugin/test/settings
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import { NAMESPACE, renderSection, replaceSection } from '../scripts/apply-settings.mjs';

const { test, cases } = suite('settings');

test('renderSection writes block YAML under the namespace key', () => {
  const text = renderSection({ appId: 'cli_x', maxMessages: 150, toolsEnabled: false });
  assert.equal(text, [
    'feishu-plugin:',
    '  appId: "cli_x"',
    '  maxMessages: 150',
    '  toolsEnabled: false',
  ].join('\n'));
});

test('an empty document becomes one section, with no placeholder left behind', () => {
  const text = replaceSection('{}\n', { appId: 'cli_x' });
  assert.equal(text, 'feishu-plugin:\n  appId: "cli_x"\n');
  assert.ok(!text.includes('{}'), 'the empty-document placeholder must be dropped');
});

test('other namespaces and their comments survive verbatim', () => {
  const original = [
    '# 我的设置',
    'agent-default-model:',
    '  provider: deepseek-official',
    '  model: deepseek-flash',
    '',
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    '',
  ].join('\n');
  const text = replaceSection(original, { appId: 'cli_x' });
  assert.ok(text.startsWith('# 我的设置\nagent-default-model:\n  provider: deepseek-official\n  model: deepseek-flash\n\nui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1'), text);
  assert.ok(text.includes('feishu-plugin:\n  appId: "cli_x"'), text);
});

test('rewriting replaces the old section instead of duplicating it', () => {
  const first = replaceSection('agent-default-model:\n  provider: deepseek-official\n', { appId: 'cli_old' });
  const second = replaceSection(first, { appId: 'cli_new', appSecret: 's' });
  const occurrences = second.split(`${NAMESPACE}:`).length - 1;
  assert.equal(occurrences, 1, `the namespace must appear exactly once:\n${second}`);
  assert.ok(second.includes('appId: "cli_new"'), second);
  assert.ok(!second.includes('cli_old'), second);
  assert.ok(second.includes('agent-default-model:'), 'the other namespace must survive a rewrite');
});

test('a nested section never bleeds into the plugin section', () => {
  const original = [
    'llm-deepseek:',
    '  apiKey: sk-abc',
    '  baseURL: https://api.deepseek.com',
    '',
  ].join('\n');
  const text = replaceSection(original, { appId: 'cli_x' });
  assert.ok(text.includes('  baseURL: https://api.deepseek.com'), text);
  assert.equal(text.split('apiKey').length - 1, 1, text);
});

test('secrets are written as plain scalars the provider can read back', () => {
  const text = replaceSection('', { appSecret: 'abc:def#ghi' });
  // A colon or hash inside an unquoted scalar would change the parse, so the
  // value must be quoted; the provider then reads the identical string.
  assert.ok(text.includes('appSecret: "abc:def#ghi"'), text);
});

export { cases };
