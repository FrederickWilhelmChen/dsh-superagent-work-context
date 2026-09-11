/**
 * Render-level cases for the plugin's settings card.
 *
 * The card exists because the Web settings page draws a form only for a
 * namespace some plugin registered a card for. Two things therefore have to
 * hold, and both are network-free here: the card must render the namespace's
 * values, and saving must write through the settings scope — including the one
 * case that would silently destroy a user's secret, an untouched secret input.
 *
 * @module dsh-feishu-plugin/test/settings-card
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './harness.mjs';

const { test, cases } = suite('settings-card');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'lib', 'client.js'), 'utf8');

/**
 * Materialize the bundle and return the settings card it registers.
 *
 * @param {{ value?: any, status?: string, writable?: boolean }} snapshot - what the scope reports.
 * @returns {{ card: Function, writes: Array<{ field: string, value: unknown }>, scope: any, render: Function }} the card and its collaborators.
 */
function loadCard(snapshot = {}) {
  const state = { status: 'ready', writable: true, value: {}, ...snapshot };
  /** @type {Array<{ field: string, value: unknown }>} */
  const writes = [];
  const scope = {
    namespace: 'feishu-plugin',
    getSnapshot: () => state,
    subscribe: () => () => {},
    set: (field, value) => {
      writes.push({ field, value });
      return Promise.resolve();
    },
  };

  /** @type {Map<any, { state: any[], memos: any[] }>} */
  const store = new Map();
  let current;
  let index = 0;
  const record = () => {
    if (!store.has(current)) store.set(current, { state: [], memos: [] });
    return store.get(current);
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const slot = record();
      const position = index++;
      if (!(position in slot.state)) slot.state[position] = typeof initial === 'function' ? initial() : initial;
      return [
        slot.state[position],
        (next) => {
          slot.state[position] = typeof next === 'function' ? next(slot.state[position]) : next;
        },
      ];
    },
    useEffect: (fn) => {
      const slot = record();
      slot.memos[index++] = fn;
    },
    useCallback: (fn, deps) => {
      const slot = record();
      const position = index++;
      const previous = slot.memos[position];
      if (previous !== undefined && previous.deps !== undefined && deps !== undefined
        && previous.deps.length === deps.length && previous.deps.every((value, at) => value === deps[at])) {
        return previous.fn;
      }
      slot.memos[position] = { fn, deps };
      return fn;
    },
    useRef: (initial) => {
      const slot = record();
      const position = index++;
      if (slot.memos[position] === undefined) slot.memos[position] = { current: initial };
      return slot.memos[position];
    },
  };

  let registration;
  const window = { __ModuleLoader__: { load: (value) => { registration = value; } } };
  // eslint-disable-next-line no-new-func -- evaluating the real bundle is the point.
  new Function('window', 'document', `${source}\n`)(window, undefined);
  const module = registration.factory((specifier) => (specifier === 'react' ? react : {}));

  /** @type {any[]} */
  const slots = [];
  module.apply({
    effect: (execute) => execute(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {} },
    slots: {
      inject: (_name, callback) => {
        callback();
        return () => {};
      },
      register: (options, component) => {
        slots.push({ options, component });
        return () => {};
      },
    },
    settingsScope: { bind: () => scope },
  });

  const card = slots.find((entry) => entry.options.name === 'settings.plugin.item');
  assert.ok(card !== undefined, 'the bundle must register a settings.plugin.item card');
  const render = (props) => {
    const previous = current;
    current = props.component;
    index = 0;
    try {
      return props.component(props);
    } finally {
      current = previous;
      index = 0;
    }
  };
  // Render once so the seeding effect is registered, run it, then render again
  // with the seeded draft — the sequence React performs on mount.
  const first = render({ component: card.component, t: (key) => key, scope });
  const effects = store.get(card.component).memos.filter((entry) => typeof entry === 'function');
  for (const effect of effects) effect();
  return { card: card.component, writes, scope, render, first, render2: () => render({ component: card.component, t: (key) => key, scope }) };
}

/**
 * Every element in a tree whose props match a predicate.
 *
 * Child components are invoked on the way down: a rendered tree holds the
 * element descriptor a child returns, not its expanded output, and every
 * component here is hook-free below the card so invoking is faithful.
 * @param {any} node - tree or subtree.
 * @param {(node: any) => boolean} predicate - match test.
 * @returns {any[]} matching elements.
 */
function findNodes(node, predicate) {
  const found = [];
  const collect = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') return;
    if (Array.isArray(value)) {
      for (const child of value) collect(child);
      return;
    }
    if (typeof value !== 'object') return;
    if (typeof value.type === 'function') {
      collect(value.type(value.props));
      return;
    }
    if (predicate(value)) found.push(value);
    collect(value.children);
  };
  collect(node);
  return found;
}

/** The card's text content, flattened. */
function textOf(node) {
  const parts = [];
  const collect = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) collect(child);
      return;
    }
    collect(value.children);
  };
  collect(node);
  return parts.join(' ');
}

test('the card renders the values the host serves', () => {
  const bundle = loadCard({
    value: { appId: 'cli_real', baseUrl: 'https://open.larksuite.com', maxMessages: 321, toolsEnabled: false },
  });
  const view = bundle.render2();
  const inputs = findNodes(view, (node) => node.type === 'input');
  const byType = (type) => inputs.filter((node) => node.props.type === type);
  assert.equal(byType('text')[0].props.value, 'cli_real', 'App ID must render from the snapshot');
  assert.equal(byType('text')[1].props.value, 'https://open.larksuite.com');
  assert.equal(byType('number')[0].props.value, '321');
  assert.equal(byType('checkbox')[0].props.checked, false, 'toolsEnabled false must render unchecked');
  const secret = byType('password')[0];
  assert.equal(secret.props.value, '', 'a stored secret is never sent back, so the field starts empty');
});

test('an untouched secret is not written back as an empty value', async () => {
  const bundle = loadCard({ value: { appId: 'cli_real' } });
  const view = bundle.render2();
  const save = findNodes(view, (node) => node.type === 'button')[0];
  save.props.onClick();
  await new Promise((done) => setTimeout(done, 0));
  assert.ok(bundle.writes.some((write) => write.field === 'appId'), 'saving must write the changed fields');
  assert.ok(
    !bundle.writes.some((write) => write.field === 'appSecret'),
    'leaving the secret box empty must not erase the stored secret',
  );
});

test('a blank draft never erases a stored value', async () => {
  // The first save used to write every field, so a field the snapshot had not
  // delivered yet was written as an empty string. That is how a configured
  // redirect URI got wiped — and an empty redirect URI makes Feishu refuse both
  // the authorize page (20029) and the token exchange (20063).
  const bundle = loadCard({ value: {} });
  const view = bundle.render2();
  const save = findNodes(view, (node) => node.type === 'button')[0];
  save.props.onClick();
  await new Promise((done) => setTimeout(done, 0));
  const blank = bundle.writes.filter((write) => write.value === '' || write.value === null);
  assert.deepEqual(blank, [], `no field may be written blank: ${JSON.stringify(bundle.writes)}`);
  // The one boolean still has a meaningful value in a blank draft.
  assert.deepEqual(bundle.writes, [{ field: 'toolsEnabled', value: true }]);
});

test('a stored redirect URI is submitted unchanged by an unrelated save', async () => {
  const redirect = 'https://agent-api.star-mission.com/webhooks/feishu/oauth/callback';
  const bundle = loadCard({ value: { appId: 'cli_real', oauthRedirectUri: redirect } });
  const appIdInput = findNodes(bundle.render2(), (node) => node.type === 'input' && node.props.type === 'text')[0];
  appIdInput.props.onChange({ target: { value: 'cli_changed' } });
  const save = findNodes(bundle.render2(), (node) => node.type === 'button')[0];
  save.props.onClick();
  await new Promise((done) => setTimeout(done, 0));
  const redirectWrite = bundle.writes.find((write) => write.field === 'oauthRedirectUri');
  assert.ok(redirectWrite !== undefined, 'an unchanged field is still submitted with its value');
  assert.equal(redirectWrite.value, redirect, 'and that value is the stored one, not an empty string');
});

test('a typed secret is written through', async () => {
  const bundle = loadCard({ value: { appId: 'cli_real' } });
  let view = bundle.render2();
  const secret = findNodes(view, (node) => node.type === 'input' && node.props.type === 'password')[0];
  secret.props.onChange({ target: { value: 'fresh-secret' } });
  view = bundle.render2();
  const save = findNodes(view, (node) => node.type === 'button')[0];
  save.props.onClick();
  await new Promise((done) => setTimeout(done, 0));
  const written = bundle.writes.find((write) => write.field === 'appSecret');
  assert.ok(written !== undefined, 'a typed secret must be written');
  assert.equal(written.value, 'fresh-secret');
});

test('an unparseable number blocks the save instead of writing null', async () => {
  const bundle = loadCard({ value: { appId: 'cli_real' } });
  let view = bundle.render2();
  const number = findNodes(view, (node) => node.type === 'input' && node.props.type === 'number')[0];
  number.props.onChange({ target: { value: 'not-a-number' } });
  view = bundle.render2();
  const save = findNodes(view, (node) => node.type === 'button')[0];
  save.props.onClick();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(bundle.writes.length, 0, 'nothing may be written when a field is invalid');
  assert.ok(textOf(bundle.render2()).includes('settings.invalidNumber'), textOf(bundle.render2()));
});

test('an unavailable namespace explains the fallback instead of offering a form', () => {
  const bundle = loadCard({ status: 'unavailable' });
  const view = bundle.render2();
  assert.equal(findNodes(view, (node) => node.type === 'input').length, 0, 'no form may render when the namespace is unavailable');
  assert.ok(textOf(view).includes('settings.unavailable'), textOf(view));
});

test('a read-only deployment disables the save control', () => {
  const bundle = loadCard({ writable: false, value: { appId: 'cli_real' } });
  const view = bundle.render2();
  const save = findNodes(view, (node) => node.type === 'button')[0];
  assert.equal(save.props.disabled, true);
  assert.ok(textOf(view).includes('settings.readOnly'), textOf(view));
});

export { cases };
