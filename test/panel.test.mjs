/**
 * Render-level cases for the panel's rows, copy, and the parts of the chat tab
 * that are not the transcript itself.
 *
 * The one behavior the whole plugin exists for is pinned here: given the props
 * a session slot actually receives, pressing a row's button must append to the
 * composer draft without discarding what the user already typed.
 *
 * @module dsh-feishu-plugin/test/panel
 */

import assert from 'node:assert/strict';
import { suite } from './harness.mjs';
import {
  findInsertButton,
  findNode,
  insertButtonFor,
  loadBundle,
  nodesWithClass,
  panelStateOf,
  propsFor,
  renderTabPanel,
  sessionProps,
  source,
  themeSource,
} from './panel-harness.mjs';

const { test, cases } = suite('panel');

test('a task row renders an insert button that is enabled with a composer', () => {
  const bundle = loadBundle();
  const button = insertButtonFor(bundle, {
    task: { id: 'g1', title: '写周报', due: undefined, dueAllDay: false, completed: false, tasklistName: '团队清单' },
    written: [],
  });
  assert.equal(button.props.disabled, false);
  assert.ok(button.props.title.includes('写周报'), `the button must title itself with the block: ${button.props.title}`);
  assert.ok(button.props.className.includes('dsh-feishu-btn'));
});
test('pressing the button appends, keeping the draft the user already typed', () => {
  const bundle = loadBundle();
  const written = [];
  const button = insertButtonFor(bundle, {
    task: { id: 'g1', title: '写周报', due: undefined, dueAllDay: false, completed: false, tasklistName: '团队清单' },
    draft: '已有的内容',
    written,
  });
  button.props.onClick();
  assert.equal(written.length, 1, 'the button must write the draft exactly once');
  assert.ok(written[0].startsWith('已有的内容'), `existing text must survive: ${JSON.stringify(written[0])}`);
  assert.ok(written[0].includes('写周报'), written[0]);
  assert.ok(written[0].includes('团队清单'), written[0]);
  assert.ok(written[0].includes('\n'), 'the appended block must start on its own line');
});

test('an empty draft receives the block with no leading newline', () => {
  const bundle = loadBundle();
  const written = [];
  const button = insertButtonFor(bundle, {
    task: { id: 'g1', title: '写周报', completed: false },
    draft: '',
    written,
  });
  button.props.onClick();
  assert.equal(written.length, 1);
  assert.ok(!written[0].startsWith('\n'), `no leading newline: ${JSON.stringify(written[0])}`);
  assert.ok(written[0].includes('写周报'), written[0]);
});

test('the button is disabled when the session has no composer', () => {
  const bundle = loadBundle();
  const button = insertButtonFor(bundle, {
    task: { id: 'g1', title: '写周报', completed: false },
    written: [],
    hasComposer: false,
  });
  assert.equal(button.props.disabled, true, 'a missing inputActions seat must disable the button');
});

test('a task without a due date or task list renders no chips', () => {
  const bundle = loadBundle();
  const view = bundle.hooks.render(bundle.components.get('TasksView'), {
    state: { tasks: [{ id: 'g1', title: '无期限任务', due: undefined, dueAllDay: false, completed: false }], tasksSource: 'tasklists' },
    t: (key) => key,
    busy: false,
    onComplete: () => {},
    face: { insert: () => {}, inserted: null, available: true, hint: '' },
  });
  assert.equal(nodesWithClass(view, 'dsh-feishu-chip').length, 0, 'no due date and no task list means no chips');
});

test('an overdue task is marked and a completed task is struck through', () => {
  const bundle = loadBundle();
  const render = (task) => bundle.hooks.render(bundle.components.get('TasksView'), {
    state: { tasks: [task], tasksSource: 'my_tasks' },
    t: (key) => key,
    busy: false,
    onComplete: () => {},
    face: { insert: () => {}, inserted: null, available: true, hint: '' },
  });
  const overdueChips = nodesWithClass(render({ id: 'g1', title: '逾期任务', due: Date.now() - 86_400_000, dueAllDay: true, completed: false }), 'dsh-feishu-chip');
  assert.equal(overdueChips.length, 1);
  assert.equal(overdueChips[0].props['data-tone'], 'warn');
  assert.ok(overdueChips[0].children.join('').includes('label.overdue'), overdueChips[0].children);

  const title = findNode(render({ id: 'g2', title: '已完成', completed: true }), (node) => node.props?.className === 'dsh-feishu-title');
  assert.equal(title.props['data-done'], 'true');
});

test('a row being completed and a row that just completed render their own state', () => {
  // The completion effect has three phases and each one has to be visible: the
  // write in flight, the write that landed, and the row taken out of the list.
  const bundle = loadBundle();
  const task = { id: 'g1', title: '写周报', completed: false };
  /** Find the completion control of the single row. */
  const completeButton = (view) => findNode(view, (node) => node.type === 'button' && String(node.props.className).includes('dsh-feishu-complete'));
  const render = (extra) => bundle.hooks.render(bundle.components.get('TasksView'), {
    state: { tasks: [task], tasksSource: 'my_tasks', tasksLoaded: true },
    t: (key) => key,
    busy: false,
    onComplete: () => {},
    face: { insert: () => {}, inserted: null, available: true, hint: '' },
    ...extra,
  });

  const idle = completeButton(render({}));
  assert.equal(idle.props['data-state'], 'idle');
  assert.deepEqual(idle.children, ['action.complete']);

  const pending = render({ pending: 'g1' });
  assert.equal(completeButton(pending).props['data-state'], 'pending');
  assert.ok(JSON.stringify(completeButton(pending).children).includes('action.completing'), 'the in-flight button must say it is syncing');
  assert.equal(nodesWithClass(pending, 'dsh-feishu-spin').length, 1, 'and show a spinner');

  const done = render({ justDone: 'g1' });
  assert.equal(completeButton(done).props['data-state'], 'done');
  assert.ok(JSON.stringify(completeButton(done).children).includes('action.completed'), 'the landed button must say it is done');
  assert.equal(findNode(done, (node) => node.props?.className === 'dsh-feishu-row').props['data-state'], 'done', 'the row itself turns green');

  // Removed rows are dropped from the list, which is what a successful write
  // means for a list of *open* tasks.
  const hidden = render({ removed: { g1: true } });
  assert.equal(completeButton(hidden), undefined);
  assert.equal(nodesWithClass(hidden, 'dsh-feishu-row').length, 0);
});

test('the stylesheet only asks for design tokens this DSH build defines', () => {
  // Scan the stylesheet itself, not the module: the comments around it name the
  // broken tokens on purpose, and a prose mention is not a rule.
  const start = source.indexOf('const CSS = [');
  const end = source.indexOf("].join('\\n');", start);
  assert.ok(start !== -1 && end > start, 'the bundle must declare its stylesheet as a CSS array');
  // Drop the line comments the array carries: a comment that *names* a broken
  // token (which the palette comment does, on purpose) is not a rule that uses
  // it. No style string contains `//`, so this cannot eat a real token.
  const css = source.slice(start, end).replace(/^\s*\/\/.*$/gm, '');

  const theme = themeSource();
  if (theme === undefined) {
    console.log('       (skipped: no DSH installation reachable from this checkout)');
    return;
  }
  const used = [...new Set(css.match(/--dsw-[a-zA-Z0-9-]+/g) ?? [])].sort();
  assert.ok(used.length > 10, `the stylesheet must actually use the token system: ${used.length}`);
  const missing = used.filter((token) => !theme.includes(`${token}:`));
  assert.deepEqual(
    missing,
    [],
    `these tokens are not defined by @deepseek-ai/dsh-client-ui-theme, so their rules would render uncoloured: ${missing.join(', ')}`,
  );
  // The local palette aliases are the other half of the same contract: a rule
  // that reads a `--ff-*` nothing declares would fall back to its literal, which
  // is how a light-theme colour ends up on a dark background.
  const declared = new Set(css.match(/--ff-[a-zA-Z0-9-]+(?=:)/g) ?? []);
  const read = [...new Set(css.match(/var\(--ff-[a-zA-Z0-9-]+/g) ?? [])].map((call) => call.slice(4));
  const undeclared = read.filter((token) => !declared.has(token));
  assert.deepEqual(undeclared, [], `used but never declared: ${undeclared.join(', ')}`);
});

test('the toast reports the task it completed and can be dismissed', () => {
  const bundle = loadBundle();
  const toastOf = (toast) => bundle.hooks.render(bundle.components.get('Toast'), { toast, t: (key) => key, onDismiss: () => {} });

  assert.equal(toastOf(null), null, 'no toast renders nothing at all');

  const success = toastOf({ tone: 'success', text: 'toast.completed', detail: '写周报' });
  assert.equal(success.props['data-tone'], 'success');
  assert.equal(success.props.role, 'status', 'a screen reader must announce it');
  assert.equal(findNode(success, (node) => node.props?.className === 'dsh-feishu-toastTick').children.join(''), '✓');
  const text = JSON.stringify(success.children);
  assert.ok(text.includes('toast.completed') && text.includes('写周报'), text);

  const failure = toastOf({ tone: 'error', text: 'toast.failed', detail: 'permission denied' });
  assert.equal(failure.props['data-tone'], 'error');
  assert.equal(findNode(failure, (node) => node.props?.className === 'dsh-feishu-toastTick').children.join(''), '!');

  let dismissed = 0;
  const dismissable = bundle.hooks.render(bundle.components.get('Toast'), {
    toast: { tone: 'success', text: 'toast.completed', detail: '写周报' },
    t: (key) => key,
    onDismiss: () => { dismissed += 1; },
  });
  findNode(dismissable, (node) => node.props?.className === 'dsh-feishu-toastClose').props.onClick();
  assert.equal(dismissed, 1);
});

test('the authorization block stays available after a successful login', () => {
  const bundle = loadBundle();
  const chatsView = bundle.components.get('ChatsView');
  assert.ok(chatsView !== undefined, 'the bundle must declare a ChatsView component');

  /** Every element in a tree whose type matches. */
  const allOfType = (node, type) => {
    const found = [];
    const collect = (value) => {
      if (value === null || value === undefined || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const child of value) collect(child);
        return;
      }
      if (typeof value.type === 'function') {
        collect(value.type(value.props));
        return;
      }
      if (value.type === type) found.push(value);
      collect(value.children);
    };
    collect(node);
    return found;
  };

  const renderWith = (auth) => bundle.hooks.render(chatsView, {
    chats: [],
    t: (key) => key,
    busy: false,
    summary: null,
    transcript: null,
    self: { id: '', name: '', avatar: undefined },
    chatId: '',
    hours: 24,
    sub: 'messages',
    onPick: () => {},
    onRange: () => {},
    onSub: () => {},
    onSummarize: () => {},
    onFetch: () => {},
    onLogin: () => {},
    face: { insert: () => {}, inserted: null, available: true, hint: '' },
    auth,
  });

  // The redirect lands on another service's callback, so the user carries the
  // code back by hand. That box must still be there once the panel believes
  // login succeeded, or a second attempt has nowhere to paste.
  const loggedIn = renderWith({ showLogin: false, userLoggedIn: true, userName: '张三', onComplete: () => {} });
  const inputs = allOfType(loggedIn, 'input');
  assert.equal(inputs.length, 1, 'the callback-URL input must render for a logged-in panel too');
  assert.ok(String(inputs[0].props.placeholder).includes('oauth/callback'), inputs[0].props.placeholder);
  const collapsed = allOfType(loggedIn, 'details');
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].props.open, false, 'a completed login collapses the block but keeps it reachable');

  const loggedOut = renderWith({ showLogin: true, userLoggedIn: false, userName: '', onComplete: () => {} });
  const expanded = allOfType(loggedOut, 'details');
  assert.equal(expanded[0].props.open, true, 'a pending login opens the block by default');
});

test('an empty group list says so, and a populated one lists the groups', () => {
  const bundle = loadBundle();
  const chatsView = bundle.components.get('ChatsView');
  const renderWith = (chats) => bundle.hooks.render(chatsView, {
    chats,
    t: (key) => key,
    busy: false,
    summary: null,
    transcript: null,
    self: { id: '', name: '', avatar: undefined },
    chatId: chats.length > 0 ? chats[0].id : '',
    hours: 24,
    sub: 'messages',
    onPick: () => {},
    onRange: () => {},
    onSub: () => {},
    onSummarize: () => {},
    onFetch: () => {},
    onLogin: () => {},
    face: { insert: () => {}, inserted: null, available: true, hint: '' },
    auth: { showLogin: false, userLoggedIn: true, userName: 'me', onComplete: () => {} },
  });

  /**
   * Flattened text of a tree, expanding child components on the way down.
   *
   * A rendered tree holds element descriptors, so a child component's own text
   * only appears once that component is invoked — otherwise a case asserting on
   * visible copy silently reads nothing.
   */
  const textOfView = (node) => {
    const parts = [];
    const collect = (value) => {
      if (value === null || value === undefined) return;
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(String(value));
        return;
      }
      if (Array.isArray(value)) {
        for (const child of value) collect(child);
        return;
      }
      if (typeof value !== 'object') return;
      if (typeof value.type === 'function') {
        collect(value.type(value.props));
        return;
      }
      collect(value.children);
    };
    collect(node);
    return parts.join(' ');
  };

  // The range selector is another <select>, so the group options are located by
  // the fact that a group option's value is a chat id.
  const optionsOf = (view) => {
    const options = [];
    const collect = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) collect(child);
        return;
      }
      if (typeof node.type === 'function') {
        collect(node.type(node.props));
        return;
      }
      if (node.type === 'option') options.push(node);
      collect(node.children);
    };
    collect(view);
    return options.filter((node) => String(node.props.value).startsWith('oc_') || String(node.props.value) === '');
  };

  const empty = renderWith([]);
  assert.equal(optionsOf(empty).length, 1, 'an empty list renders one placeholder option');
  assert.ok(textOfView(empty).includes('empty.chats'), textOfView(empty));

  const populated = renderWith([
    { id: 'oc_1', name: 'DragonBowl工作组' },
    { id: 'oc_2', name: 'Snapia 工作组' },
  ]);
  const options = optionsOf(populated);
  assert.equal(options.length, 2, 'every group the server returned must be selectable');
  assert.deepEqual(options.map((node) => node.props.value), ['oc_1', 'oc_2']);
  assert.ok(textOfView(populated).includes('Snapia 工作组'), textOfView(populated));
  assert.ok(!textOfView(populated).includes('empty.chats'), 'the placeholder must not appear alongside real groups');
});

test('each tab refreshes its own Feishu endpoint', () => {
  // The panel once shipped `/api/chats/refresh` on the host and never called it,
  // so the group list read an empty server cache forever and claimed the bot was
  // in no groups. The refresh control now follows the visible tab.
  const bundle = loadBundle();
  const calls = [];
  const originalFetch = globalThis.fetch;
  /** Answer `/api/state` with a real shape so the panel leaves its loading state. */
  const stub = () => {
    globalThis.fetch = (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      const isState = String(url).endsWith('/api/state');
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: isState
            ? {
              configured: true,
              userLoggedIn: true,
              llmAvailable: true,
              tasks: [],
              chats: [{ id: 'oc_1', name: '群一' }],
              tasksSource: 'my_tasks',
            }
            : { chats: [] },
        }),
      });
    };
  };

  const body = bundle.slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  stub();
  let view;
  try {
    view = renderTabPanel(bundle, sessionProps({ draft: '', write: () => {} }));
  } finally {
    globalThis.fetch = originalFetch;
  }

  /** The toolbar's refresh control is the first button of the panel root. */
  const refresh = findNode(view, (node) => node.type === 'button' && String(node.props.className) === 'dsh-feishu-btn');
  assert.ok(refresh !== undefined, 'the toolbar must render a refresh control');

  return (async () => {
    calls.length = 0;
    stub();
    try {
      await refresh.props.onClick();
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.ok(
      calls.some((call) => call.url.includes('/api/tasks/refresh')),
      `the tasks tab must refresh tasks: ${JSON.stringify(calls)}`,
    );
    assert.ok(
      !calls.some((call) => call.url.includes('/api/chats/refresh')),
      `the tasks tab must not refresh groups: ${JSON.stringify(calls)}`,
    );
  })();
});

export { cases };
