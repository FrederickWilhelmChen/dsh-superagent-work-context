/**
 * Cases for the plugin's way in — the sidebar entry, its page, and the two
 * panel-level flows that go through a real request cycle.
 *
 * @module dsh-feishu-plugin/test/panel-entry
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import {
  findNode,
  loadBundle,
  panelStateOf,
  propsFor,
  renderTabPanel,
  sessionProps,
} from './panel-harness.mjs';

const { test, cases } = suite('panel.entry');

/**
 * Install a fetch stub that answers the panel's routes from a path→data table.
 *
 * The stub stays installed for a whole case on purpose: the panel loads on
 * mount *and* again when a tab effect or an action asks for it, so a case that
 * swapped stubs mid-flight would race its own assertions. A route value may be
 * a function to answer differently per call, or to hold a response open.
 *
 * @param {Record<string, any>} routes - route suffix (e.g. `/api/state`) to `data` or `() => data | Promise<data>`.
 * @returns {{ calls: Array<{ path: string, method: string }>, restore: () => void }} the recorded calls and the undo handle.
 */
function stubPanelApi(routes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, init) => {
    const path = String(url);
    calls.push({ path, method: init?.method ?? 'GET' });
    const suffix = Object.keys(routes).find((key) => path.endsWith(key));
    assert.ok(suffix !== undefined, `the panel called an unexpected route: ${path}`);
    const answer = routes[suffix];
    const data = typeof answer === 'function' ? answer(calls.filter((call) => call.path === path).length) : answer;
    return Promise.resolve(data).then((value) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: value }),
    }));
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Wait for the microtask/macrotask queue, i.e. let one pending request land. */
const flush = (ms = 0) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('the sidebar entry opens the panel beside the session', () => {
  // Why the entry lives in the sidebar's foot rather than in a rail *panel* row:
  // selecting such a row swaps the centre column, and the right Sidebar's
  // session surface only exists while the Conversation is selected — so by the
  // time a page could open the tab there would be no session to open it in. This
  // seat's click is the plugin's own, so the tab opens first and the centre never
  // moves.
  const bundle = loadBundle();
  const entry = bundle.components.get('SidebarAction');
  assert.ok(entry !== undefined, 'the bundle must declare the sidebar entry');

  const opened = [];
  const selected = [];
  const props = {
    wide: true,
    t: (key) => key,
    sidebarRight: { openTab: (kind) => opened.push(kind) },
    layout: { selectPanel: (id) => selected.push(id) },
  };
  const button = bundle.hooks.render(entry, props);
  assert.equal(button.type, 'button');
  assert.equal(button.props.className, 'dsh-feishu-footBtn');
  assert.equal(button.props['data-wide'], 'true');
  assert.equal(button.props['aria-label'], 'tab.title');
  assert.equal(button.children[0].type, bundle.components.get('FeishuIcon'), 'the entry draws the mark');
  assert.equal(button.children[0].props.size, 16, 'at the shell footer row\'s glyph size');
  assert.equal(button.children[1].props.className, 'dsh-feishu-footLabel');
  assert.deepEqual(button.children[1].children, ['tab.title'], 'the wide row is icon plus the localized label');

  button.props.onClick();
  assert.deepEqual(opened, ['feishu'], 'the click must open the Feishu tab');
  assert.deepEqual(selected, [], 'and must not touch the centre column while a session is up');
});

test('the sidebar entry shows a page instead when there is no session', () => {
  const bundle = loadBundle();
  const entry = bundle.components.get('SidebarAction');
  const selected = [];
  const button = bundle.hooks.render(entry, {
    wide: false,
    t: (key) => key,
    // What `openTab` does with no mounted session surface.
    sidebarRight: { openTab: () => { throw new Error('no session surface'); } },
    layout: { selectPanel: (id) => selected.push(id) },
  });
  // The rail draws one glyph per row, so the label is not rendered there.
  assert.equal(button.props['data-wide'], 'false');
  assert.equal(button.children.length, 2, 'a narrow row is the glyph alone');
  assert.equal(button.children[1], null);

  button.props.onClick();
  assert.deepEqual(selected, ['dsh-feishu-plugin'], 'with no session the entry falls back to its page');
});

test('the fallback page is the no-session view, with inert insertion', () => {
  const bundle = loadBundle();
  const page = bundle.components.get('FeishuMainPanel');
  assert.ok(page !== undefined, 'the bundle must declare the fallback page');
  const tree = bundle.hooks.render(page, { t: (key) => key });
  assert.equal(findNode(tree, (node) => node.props?.className === 'dsh-feishu-main') !== undefined, true);

  const panel = propsFor(tree, bundle.components.get('PanelBody'));
  assert.equal(panel.notice, 'panel.noSession', 'the page must say why insertion is unavailable');
  assert.equal(panel.face.available, false, 'and offer no inert insertion face');

  // The disabled button carries the reason rather than the generic insert hint.
  const button = bundle.hooks.render(bundle.components.get('InsertButton'), {
    face: panel.face,
    text: '- [ ] 写周报',
    t: (key) => key,
  });
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.title, 'action.insertUnavailable');
});

test('the Feishu mark is the supplied logo, not a redrawn glyph', () => {
  const bundle = loadBundle();
  const mark = bundle.hooks.render(bundle.components.get('FeishuIcon'), { size: 18, className: 'x' });
  assert.equal(mark.type, 'img', 'the brand mark keeps its own colours, so it is an image');
  assert.equal(mark.props.width, 18, 'the caller decides the size');
  assert.equal(mark.props.height, 18);
  assert.equal(mark.props.className, 'dsh-feishu-mark x', 'the seat may add its own class');
  assert.equal(mark.props.alt, '', 'the mark is decoration: every seat carries its own text');
  assert.equal(mark.props['aria-hidden'], 'true');

  // The source has to be a real PNG of the logo the user supplied: checking the
  // signature catches a truncated paste, which is otherwise invisible until the
  // browser draws a broken image.
  const src = String(mark.props.src);
  assert.ok(src.startsWith('data:image/png;base64,'), src.slice(0, 40));
  const bytes = Buffer.from(src.slice('data:image/png;base64,'.length), 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.deepEqual([width, height], [48, 48], 'the mark is the 48px artwork');
  assert.equal(bytes[25], 6, 'colour type 6: RGBA, so the mark has no white plate behind it');

  const defaults = bundle.hooks.render(bundle.components.get('FeishuIcon'), {});
  assert.equal(defaults.props.width, 16, 'a seat that says nothing gets the 16px default');
  assert.equal(defaults.props.className, 'dsh-feishu-mark');
});

test('a failed tasks refresh is reported instead of an empty list', async () => {
  // The forced refresh answers an empty list *plus* an error when the read
  // fails, and the refresh control used to patch only `tasks` back into state.
  // The panel then printed 「没有未完成的任务」 over a broken read — the one wrong
  // answer a user has no way to diagnose.
  const bundle = loadBundle();
  const failure = '读取「我负责的」任务失败：server error';
  // A non-empty group list keeps the chats tab effect from firing its own load
  // and patching state underneath this case.
  const api = stubPanelApi({
    '/api/state': { configured: true, userLoggedIn: true, tasks: [], chats: [{ id: 'oc_1', name: '群一' }] },
    '/api/tasks/refresh': { items: [], source: 'tasklists', error: failure },
  });
  try {
    let view = renderTabPanel(bundle, sessionProps({ draft: '', write: () => {} }));
    await flush();
    view = renderTabPanel(bundle, sessionProps({ draft: '', write: () => {} }));
    const refresh = findNode(view, (node) => node.type === 'button' && String(node.props.className) === 'dsh-feishu-btn');
    assert.ok(refresh !== undefined, 'the toolbar must render a refresh control');

    // The control fires and forgets (`void reload(true)`), so the handler's
    // promise is not the one to await — the patch lands on a later microtask.
    refresh.props.onClick();
    await flush();
    view = renderTabPanel(bundle, sessionProps({ draft: '', write: () => {} }));

    const state = panelStateOf(bundle);
    assert.equal(state.tasksError, failure, `the failure must reach the panel state: ${JSON.stringify(state)}`);
    assert.equal(state.tasksLoaded, true, 'the state must count as loaded, or the panel shows its spinner');

    const tasksProps = propsFor(view, bundle.components.get('TasksView'));
    const rendered = bundle.hooks.render(bundle.components.get('TasksView'), tasksProps);
    const note = findNode(rendered, (node) => node.props?.tone === 'error');
    assert.ok(note !== undefined, 'the failure must be rendered');
    assert.ok(note.children.join(' ').includes(failure), note.children);
    assert.equal(
      findNode(rendered, (node) => node.props?.className === 'dsh-feishu-empty'),
      undefined,
      'a failed read must not render as the empty-list message',
    );
  } finally {
    api.restore();
  }
});

test('completing a task announces it, then takes the row out of the list', async () => {
  // The whole point of the success effect: a write to Feishu used to make the
  // row disappear with no other signal, which reads as a glitch. Three things
  // must happen, in this order — the button says it is syncing, the toast and
  // the green row confirm the write landed, and only then does the list drop the
  // row.
  const bundle = loadBundle();
  const task = { id: 'g1', title: '写周报', completed: false };
  /** Held open so the in-flight state can be observed instead of raced. */
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  const api = stubPanelApi({
    '/api/state': { configured: true, userLoggedIn: true, llmAvailable: true, tasksLoaded: true, tasksSource: 'my_tasks', tasks: [task], chats: [{ id: 'oc_1', name: '群一' }] },
    '/api/tasks/complete': () => writeGate.then(() => ({ id: 'g1' })),
    '/api/tasks/refresh': { items: [], source: 'my_tasks' },
  });
  const completeButton = (tasksProps) => {
    const rendered = bundle.hooks.render(bundle.components.get('TasksView'), tasksProps);
    return {
      rendered,
      button: findNode(rendered, (node) => node.type === 'button' && String(node.props.className).includes('dsh-feishu-complete')),
    };
  };
  try {
    const props = sessionProps({ draft: '', write: () => {} });
    const draw = async (waitMs = 0) => {
      // Render once to fire the mount effect, let its request (and any hold the
      // effect's own timeline needs) land, then render again to see the state.
      renderTabPanel(bundle, props);
      await flush(waitMs);
      const tree = renderTabPanel(bundle, props);
      return { tree, tasksProps: propsFor(tree, bundle.components.get('TasksView')), toast: propsFor(tree, bundle.components.get('Toast')).toast };
    };

    const mounted = await draw();
    const first = completeButton(mounted.tasksProps);
    assert.ok(first.button !== undefined, 'the row must offer a completion control');
    assert.equal(first.button.props['data-state'], 'idle');
    assert.equal(mounted.toast, null, 'nothing is announced before the click');

    first.button.props.onClick();
    const inFlight = await draw();
    assert.equal(completeButton(inFlight.tasksProps).button.props['data-state'], 'pending', 'the write in flight must be visible');
    assert.equal(inFlight.toast, null, 'and must not claim success yet');

    releaseWrite();
    const landed = await draw();
    assert.equal(completeButton(landed.tasksProps).button.props['data-state'], 'done', 'the landed write must be visible on the row');
    assert.equal(landed.tasksProps.justDone, 'g1');
    assert.ok(landed.toast !== null, 'a successful write must be announced');
    assert.equal(landed.toast.tone, 'success');
    assert.equal(landed.toast.detail, '写周报', 'the toast names the task it completed');

    // After the hold the refresh is authoritative: the row is gone and the list
    // was re-read rather than patched by hand.
    const settled = await draw(1200);
    assert.equal(completeButton(settled.tasksProps).button, undefined, 'a completed task must leave the open list');
    assert.ok(api.calls.some((call) => call.path.endsWith('/api/tasks/refresh')), `the list must be re-read: ${JSON.stringify(api.calls)}`);
  } finally {
    api.restore();
  }
});

export { cases };
