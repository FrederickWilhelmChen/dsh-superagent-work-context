/**
 * The shared stand-in the panel cases render through.
 *
 * The browser bundle cannot run in Node: it needs a module loader, React, and a
 * DOM. This harness supplies just enough of all three — a hook-supporting React
 * stand-in, the bundle materialized from source, and the tree walkers the cases
 * assert with — so every case exercises the shipped components rather than a
 * reimplementation of them.
 *
 * @module dsh-feishu-plugin/test/panel-harness
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInstallModules } from '../scripts/bootstrap-deps.mjs';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const source = readFileSync(join(repoRoot, 'lib', 'client.js'), 'utf8');

export function themeSource() {
  let installation;
  try {
    installation = findInstallModules(undefined);
  } catch {
    return undefined;
  }
  const file = join(installation, '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js');
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/**
 * Build the props one session-scope slot component receives.
 * @param {{ draft: string, write: (text: string) => void, hasComposer?: boolean }} input - composer state.
 * @returns {any} composed props.
 */
export function sessionProps(input) {
  const hasComposer = input.hasComposer !== false;
  return {
    sessionId: 'session-1',
    useInput: (selector) => selector({ draft: input.draft, draftRev: 1 }),
    inputActions: hasComposer
      ? {
        setDraft: input.write,
        submit: () => {},
        addAttachments: () => false,
        removeAttachment: () => {},
        pruneAttachments: () => {},
      }
      : undefined,
    t: (key) => key,
    sidebarRight: { openTab: () => {} },
  };
}

/**
 * Materialize the bundle's factory with a hook-supporting React stand-in.
 * @returns {{ module: any, components: Map<string, Function>, hooks: any, slots: any[], store: Map<any, { state: any[], memos: any[], effects: any[] }> }} bundle face.
 */
export function loadBundle() {
  /** @type {Map<string, Function>} every function component the bundle renders. */
  const components = new Map();
  /** @type {Map<any, { state: any[], memos: any[], effects: any[] }>} */
  const store = new Map();
  let current;
  let index = 0;
  /** Effects queued by the render in progress; flushed when it returns. */
  let queued = [];

  /** The hook record of the component currently rendering. */
  const slot = (kind) => {
    if (current === undefined) throw new Error(`${kind} called outside a component render`);
    if (!store.has(current)) store.set(current, { state: [], memos: [], effects: [] });
    return store.get(current);
  };

  const react = {
    createElement: (type, props, ...children) => {
      if (typeof type === 'function') components.set(type.name, type);
      return { type, props: props ?? {}, children };
    },
    useState: (initial) => {
      const record = slot('useState');
      const position = index++;
      if (!(position in record.state)) record.state[position] = initial;
      return [
        record.state[position],
        (next) => {
          record.state[position] = typeof next === 'function' ? next(record.state[position]) : next;
        },
      ];
    },
    // Effects run after the render returns, the way React runs them after a
    // commit — a component that loads its own data on mount cannot be tested at
    // all if its effect is dropped, and the panel's mount load is exactly the
    // path that broke in production.
    useEffect: (fn, deps) => {
      const record = slot('useEffect');
      const position = index++;
      const previous = record.effects[position];
      const unchanged = previous !== undefined && deps !== undefined && previous.deps !== undefined
        && previous.deps.length === deps.length && previous.deps.every((value, at) => value === deps[at]);
      if (unchanged) return;
      queued.push({ record, position, fn, deps });
    },
    useCallback: (fn, deps) => {
      const record = slot('useCallback');
      const position = index++;
      const previous = record.memos[position];
      if (previous !== undefined && previous.deps !== undefined && deps !== undefined
        && previous.deps.length === deps.length && previous.deps.every((value, at) => value === deps[at])) {
        return previous.fn;
      }
      record.memos[position] = { fn, deps };
      return fn;
    },
    useRef: (initial) => {
      const record = slot('useRef');
      const position = index++;
      if (record.memos[position] === undefined) record.memos[position] = { current: initial };
      return record.memos[position];
    },
  };

  // The panel fetches its state on mount; in a unit context that call must
  // never settle, or a rejection would race the assertions.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});

  let registration;
  const window = { __ModuleLoader__: { load: (value) => { registration = value; } } };
  // eslint-disable-next-line no-new-func -- evaluating the real bundle is the point.
  new Function('window', 'document', `${source}\n`)(window, undefined);
  const module = registration.factory((specifier) => (specifier === 'react' ? react : {}));

  /**
   * Render one component under the hook runtime and flush its effects.
   *
   * Effects are flushed with the tree already built (they only read state and
   * call async loaders), and cleanup of the previous run happens first, which is
   * what lets a case re-render after an async load and see the new state.
   */
  const render = (component, props) => {
    const previous = current;
    current = component;
    index = 0;
    queued = [];
    let tree;
    try {
      tree = component(props);
    } finally {
      current = previous;
      index = 0;
    }
    const pending = queued;
    queued = [];
    for (const effect of pending) {
      const slotRecord = effect.record;
      const previousRun = slotRecord.effects[effect.position];
      if (previousRun !== undefined && typeof previousRun.cleanup === 'function') previousRun.cleanup();
      slotRecord.effects[effect.position] = { deps: effect.deps, cleanup: effect.fn() };
    }
    return tree;
  };

  // Mount the plugin so the bundle's components are captured.
  const slots = [];
  const ctx = {
    effect: (execute) => execute(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    sidebarRightTabs: { register: () => () => {} },
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
    sidebarRight: { openTab: () => {} },
    // The bundle binds a settings scope at registration; only `bind` is used.
    settingsScope: { bind: ({ namespace }) => ({ namespace }) },
  };
  module.apply(ctx);
  // The bundle exposes its view components for exactly this purpose: the panel
  // cannot reach its data-bearing branch without a network, so its rows are
  // rendered directly.
  const internals = module.internals ?? {};
  for (const [name, component] of Object.entries(internals)) {
    if (typeof component === 'function') components.set(name, component);
  }

  // Restore the real fetch: the stub existed only to keep the panel's mount
  // from settling, and leaving it installed would leak into other test modules.
  globalThis.fetch = originalFetch;
  // `store` is handed out so a case can read the state a component's own
  // handlers patched into it — the panel's refresh path cannot be observed
  // through its rendered output alone. `internals` is handed out whole as well:
  // a couple of pure helpers (how a sender is labelled) are worth asserting on
  // directly rather than only through the tree they produce.
  return { module, components, hooks: { render }, slots, store, internals };
}

/** Walk a rendered tree for the first node satisfying a predicate. */
export function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (predicate(node)) return node;
  return findNode(node.children, predicate);
}

/**
 * Find the insert button rendered for one specific row.
 *
 * `InsertButton` is a child component, so a rendered tree holds the host
 * `<button>` descriptor it would produce — not an element whose body has run.
 * The component is therefore invoked here, which is safe because it uses no
 * hooks, and its button is recognized by the `data-done` marker it sets.
 * @param {any} view - rendered tasks view.
 * @param {string} title - the task title the row must carry.
 * @returns {any} the rendered button element.
 */
export function findInsertButton(view, title) {
  /** @type {any[]} */
  const componentNodes = [];
  /** @type {any[]} */
  const buttons = [];
  const collect = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) collect(child);
      return;
    }
    if (typeof node.type === 'function' && node.type.name === 'InsertButton') componentNodes.push(node);
    if (node.type === 'button' && node.props?.['data-done'] !== undefined) buttons.push(node);
    collect(node.children);
  };
  collect(view);
  for (const node of componentNodes) {
    const rendered = node.type(node.props);
    buttons.push({ text: node.props.text, element: rendered });
  }
  // The translate stub echoes its keys, so the composer block a button carries
  // is recoverable from its own props even though `InsertButton` only puts the
  // block in `title` when a composer exists.
  const button = buttons.find((entry) => typeof entry.text === 'string' && entry.text.includes(title));
  assert.ok(button !== undefined, `row "${title}" must render an insert button (found ${buttons.length})`);
  return button.element;
}

/** Every element in a tree whose `props.className` matches. */
export function nodesWithClass(node, className) {
  const found = [];
  const collect = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) collect(child);
      return;
    }
    if (value.props?.className === className) found.push(value);
    collect(value.children);
  };
  collect(node);
  return found;
}

/**
 * Render the tasks view with one task and return the insert button it wires up.
 * @param {{ components: Map<string, Function>, hooks: any }} bundle - loaded bundle.
 * @param {{ task: any, draft?: string, written: string[], hasComposer?: boolean }} scenario - case inputs.
 * @returns {any} the InsertButton element the row produced.
 */
export function insertButtonFor(bundle, scenario) {
  const tasksView = bundle.components.get('TasksView');
  assert.ok(tasksView !== undefined, 'the bundle must declare a TasksView component');
  const hasComposer = scenario.hasComposer !== false;
  // The button's insertion face is built by the view from the session props;
  // mirroring it here keeps the assertion on the shipped component code while
  // the panel's network-dependent mount stays out of the picture.
  const face = {
    insert: (text) => {
      if (!hasComposer) return;
      const draft = scenario.draft ?? '';
      scenario.written.push(draft.trim().length === 0 ? text : `${draft}\n${text}`);
    },
    inserted: null,
    available: hasComposer,
    hint: 'action.insertHint',
  };
  const view = bundle.hooks.render(tasksView, {
    state: { tasks: [scenario.task], tasksSource: 'my_tasks' },
    t: (key) => key,
    busy: false,
    onComplete: () => {},
    face,
  });
  return findInsertButton(view, scenario.task.title);
}

/**
 * Read the panel state the bundle's own handlers have patched in.
 *
 * The hook stand-in keeps every component's `useState` slots, and the panel's
 * `state` slot starts as `null` — so the live one is the slot that now holds a
 * task list.
 * @param {{ components: Map<string, Function>, store: Map<any, { state: any[] }> }} bundle - loaded bundle.
 * @returns {any} the panel's current state object.
 */
export function panelStateOf(bundle) {
  const panel = bundle.components.get('PanelBody');
  assert.ok(panel !== undefined, 'the bundle must declare a PanelBody component');
  const slots = bundle.store.get(panel)?.state ?? [];
  const found = slots.find((value) => value !== null && typeof value === 'object' && Array.isArray(value.tasks));
  assert.ok(found !== undefined, `the panel must hold a tasks state: ${JSON.stringify(slots)}`);
  return found;
}

/**
 * Render the right Sidebar's tab body with its nested panel expanded.
 *
 * The bundle splits the panel in two on purpose: the tab body is a session seat,
 * so it supplies the Session's insertion face, and `PanelBody` renders. The
 * stand-in builds descriptors rather than mounting children, so a case that
 * wants the panel's markup renders the body it found.
 *
 * @param {{ components: Map<string, Function>, slots: any[], hooks: any }} bundle - loaded bundle.
 * @param {any} props - session slot props.
 * @returns {any} the panel's rendered markup.
 */
export function renderTabPanel(bundle, props) {
  const body = bundle.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  assert.ok(body !== undefined, 'the bundle must register a sidebar.right.pane.tab body');
  const panelBody = bundle.components.get('PanelBody');
  assert.ok(panelBody !== undefined, 'the bundle must declare a PanelBody component');
  const node = findNode(bundle.hooks.render(body.component, props), (value) => value.type === panelBody);
  assert.ok(node !== undefined, 'the tab body must render the panel body');
  return bundle.hooks.render(panelBody, node.props);
}

/**
 * Pull one nested component's props out of a rendered panel tree.
 *
 * The stand-in builds descriptors rather than mounting children, so a component
 * nested inside the panel is reached by its type and rendered explicitly.
 * @param {any} tree - rendered panel tree.
 * @param {Function} component - the component function to find.
 * @returns {any} its props.
 */
export function propsFor(tree, component) {
  const node = findNode(tree, (value) => value.type === component);
  assert.ok(node !== undefined, `the tree must render ${component.name}`);
  return node.props;
}

/** The tab-body component the bundle registers, i.e. the panel's session face. */
export function panelComponent(bundle) {
  return bundle.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab').component;
}

/**
 * Materialize every function component in a rendered tree.
 *
 * The stand-in builds descriptors instead of mounting children, so a case that
 * asserts on what a nested component draws has to invoke it — through the hook
 * runtime, because several of them (`Avatar`, `MessageList` itself) hold state.
 * Children are handed over in `props`, which is how React passes them: a
 * component like `Note` reads `props.children`, and without this it would draw
 * an empty box here while working in the browser.
 *
 * @param {any} node - rendered tree.
 * @param {(component: Function, props: any) => any} render - the hook-aware renderer.
 * @param {number} [depth] - recursion guard.
 * @returns {any} the same tree with components replaced by their output.
 */
export function flattenWithHooks(node, render, depth = 0) {
  if (node === null || node === undefined || typeof node !== 'object' || depth > 8) return node;
  if (Array.isArray(node)) return node.map((child) => flattenWithHooks(child, render, depth));
  if (typeof node.type === 'function') {
    return flattenWithHooks(render(node.type, { ...node.props, children: node.children }), render, depth + 1);
  }
  return { ...node, children: (node.children ?? []).map((child) => flattenWithHooks(child, render, depth + 1)) };
}

/** Every element in a flattened tree matching a predicate. */
export function allNodes(node, predicate) {
  const found = [];
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (predicate(value)) found.push(value);
    walk(value.children);
  };
  walk(node);
  return found;
}

/** One projected chat row, with the fields a case does not care about defaulted. */
export function messageRow(overrides = {}) {
  return {
    id: 'om_1',
    senderId: 'ou_zhang',
    senderName: '张三',
    senderType: 'user',
    // Fixed instants, in UTC: the labels are local-time, so the cases assert on
    // structure (a separator exists, a clock is present) rather than on a
    // string that depends on the machine's time zone.
    at: Date.UTC(2026, 8, 11, 6, 30),
    text: '收到',
    kind: 'text',
    lines: ['收到'],
    media: undefined,
    mentions: [],
    parentId: undefined,
    rootId: undefined,
    threadId: undefined,
    deleted: false,
    updated: false,
    ...overrides,
  };
}
