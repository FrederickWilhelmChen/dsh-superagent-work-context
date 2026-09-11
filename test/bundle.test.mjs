/**
 * Static validation of the hand-authored client bundle.
 *
 * A browser bundle cannot be executed by Node (it needs `window`, React, and
 * the module loader), but its three failure modes are all statically
 * detectable: JavaScript that does not parse, a wrapper the module system
 * cannot key on, and a `require()` of a specifier outside the platform seed
 * table — the last one only failing at runtime, in the browser, long after a
 * deploy. These cases catch all three before boot.
 *
 * @module dsh-feishu-plugin/test/bundle
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite } from './harness.mjs';

const { test, cases } = suite('bundle');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'lib', 'client.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

/** The full platform shell seed table (the web shell's `staticModules` factory). */
const PLATFORM_SEED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

/**
 * Run the registration half of the bundle against a fake loader.
 * @returns {{ id: string, factory: Function }} the captured registration.
 */
function captureRegistration() {
  let captured;
  const window = {
    __ModuleLoader__: {
      load(registration) {
        captured = registration;
      },
    },
  };
  // eslint-disable-next-line no-new-func -- evaluating the real bundle is the point.
  new Function('window', 'document', `${source}\n`)(window, undefined);
  assert.ok(captured !== undefined, 'bundle must call window.__ModuleLoader__.load');
  return captured;
}

/**
 * A React stand-in sufficient for module materialization.
 * @returns {any} the stand-in.
 */
function reactStub() {
  return {
    createElement: () => ({}),
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: () => ({ current: null }),
  };
}

/** Every Cordis service the bundle's `inject` array must declare. */
const REQUIRED_SERVICES = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'settingsScope', 'layout'];

/**
 * The service stubs shared by the registration cases.
 *
 * `settingsScope.bind` is the browser-side owner handle over one settings
 * namespace; registration only binds it, so the stub records the namespace.
 * @returns {any} a fake client context.
 */
function contextStub() {
  return {
    settingsScope: { bind: ({ namespace }) => ({ namespace }) },
    sidebarRight: { openTab: () => {} },
    layout: { selectPanel: () => {} },
  };
}

test('bundle parses and registers under the package name', () => {
  const registration = captureRegistration();
  assert.equal(registration.id, pkg.name, 'registration id must be the package name');
  assert.equal(typeof registration.factory, 'function');
});

test('package declaration points at the bundle the host serves', () => {
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.exports['./client'].default, './lib/client.js');
  assert.ok(Array.isArray(pkg.dsh.client.inject));
  assert.ok(Array.isArray(pkg.dsh.client.external));
  assert.ok(pkg.dsh.client.external.length === 0, 'the bundle must need no non-baseline module');
});

test('factory exports apply and inject and requests only seed modules', () => {
  const registration = captureRegistration();
  /** @type {string[]} */
  const requested = [];
  const module = registration.factory((specifier) => {
    requested.push(specifier);
    assert.ok(
      PLATFORM_SEED.has(specifier),
      `bundle required "${specifier}", which is not in the platform seed table; `
      + 'it must be bundled in or declared in dsh.client.external',
    );
    return specifier === 'react' ? reactStub() : {};
  });
  assert.equal(typeof module.apply, 'function');
  assert.ok(Array.isArray(module.inject), 'inject must be the Cordis service-name array');
  assert.ok(requested.includes('react'), 'the bundle renders React elements and must require react');
  for (const service of REQUIRED_SERVICES) {
    assert.ok(module.inject.includes(service), `inject must declare ${service}`);
  }
});

test('apply registers the tab type, its body, the sidebar entry, and the settings card', () => {
  const registration = captureRegistration();
  /** @type {any[]} */
  const slots = [];
  /** @type {any[]} */
  const tabTypes = [];
  /** @type {string[]} */
  const injected = [];
  /** @type {Array<() => void>} */
  const injectCallbacks = [];
  const ctx = {
    effect: (execute) => {
      const disposer = execute();
      return disposer;
    },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    sidebarRightTabs: {
      register: (definition) => {
        tabTypes.push(definition);
        return () => {};
      },
    },
    slots: {
      inject: (name, callback) => {
        injected.push(name);
        injectCallbacks.push(callback);
        return () => {};
      },
      register: (options, component) => {
        slots.push({ options, component });
        return () => {};
      },
    },
    ...contextStub(),
  };
  const module = registration.factory((specifier) => (specifier === 'react' ? reactStub() : {}));
  module.apply(ctx);
  for (const callback of injectCallbacks) callback();

  assert.deepEqual(injected, [
    'sidebar.right.pane.tab',
    'sidebar.footer.action',
    'main',
    'settings.plugin.item',
  ]);
  assert.equal(tabTypes.length, 1);
  assert.equal(tabTypes[0].kind, 'feishu');
  assert.equal(typeof tabTypes[0].title, 'function');
  assert.equal(tabTypes[0].title(), 'tab.title', 'the title thunk must read the bound dictionary');
  assert.ok(Array.isArray(tabTypes[0].guide) && tabTypes[0].guide.length === 1);
  // Without a glyph the guide draws its cube placeholder, so the panel would be
  // the only entry in the add menu with no face.
  assert.equal(typeof tabTypes[0].guide[0].icon, 'function', 'the guide entry must carry the Feishu glyph');
  assert.equal(tabTypes[0].patterns, undefined, 'a page type must not declare address globs');

  const body = slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  assert.ok(body !== undefined, 'a sidebar.right.pane.tab body must be registered');
  assert.equal(body.options.key, tabTypes[0].id, 'the body key must be the tab definition id');
  assert.equal(body.options.locale, 'feishu');
  assert.equal(typeof body.component, 'function');

  // The sidebar entry and the page it falls back to are one entry in two seats:
  // the layout resolves the main occupant by the id the entry selects, so the
  // two keys have to match or the no-session fallback opens nothing.
  const entry = slots.find((slot) => slot.options.name === 'sidebar.footer.action');
  assert.ok(entry !== undefined, 'the left sidebar entry must be registered');
  assert.equal(typeof entry.component, 'function');
  assert.equal(entry.options.order, 55);
  assert.equal(entry.options.locale, 'feishu');
  assert.equal(entry.options.label(), 'tab.title', 'the entry label must read the bound dictionary');
  const entryFace = entry.options.inject();
  assert.equal(typeof entryFace.sidebarRight.openTab, 'function');
  assert.equal(typeof entryFace.layout.selectPanel, 'function', 'the fallback page is selected through layout');
  const page = slots.find((slot) => slot.options.name === 'main');
  assert.ok(page !== undefined, 'the entry needs a main occupant to fall back to');
  assert.equal(page.options.key, entry.options.id, 'the main key must be the entry id');
  assert.equal(typeof page.component, 'function');
  assert.equal(page.options.inject, undefined, 'the page itself needs no injected face');

  // The settings card is keyed by the namespace the host half registers; that
  // pairing is the whole contract, so the key is asserted, not just presence.
  const card = slots.find((entry) => entry.options.name === 'settings.plugin.item');
  assert.ok(card !== undefined, 'a settings.plugin.item card must be registered');
  assert.equal(card.options.key, 'feishu-plugin');
  assert.equal(typeof card.component, 'function');
  assert.equal(card.options.inject().scope.namespace, 'feishu-plugin');
  // The session header is deliberately NOT occupied any more: the rail row is
  // always there, while a header button disappears with the session.
  assert.equal(
    slots.some((entry) => entry.options.name === 'conversation.session.header.actions'),
    false,
    'the plugin must not put a button in the session header',
  );
});

export { cases };
