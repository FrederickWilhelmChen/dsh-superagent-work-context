/**
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
 *
 * `playwright-core` is not part of the DSH installation and this environment
 * denies npx the writes it would need to fetch it, but a Chromium binary is
 * already present in the Playwright browser cache. One page, one session, and
 * a handful of commands is all the browser check needs, so the protocol is
 * driven directly rather than through a browser-automation dependency.
 *
 * @module dsh-feishu-plugin/scripts/cdp
 */

import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * Candidate Chromium binaries, most-preferred first.
 *
 * The headless shell is preferred over the full browser: it needs no
 * crash-handler process, which a locked-down environment can deny, and it is
 * the same engine for this purpose.
 * @returns {string | undefined} absolute path of a usable binary.
 */
function findChromium() {
  const roots = [
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'ms-playwright'),
    process.env.USERPROFILE === undefined ? undefined : join(process.env.USERPROFILE, '.cache', 'ms-playwright'),
  ].filter((root) => root !== undefined);
  const candidates = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      candidates.push(join(root, entry, 'chrome-win', 'headless_shell.exe'));
    }
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      candidates.push(join(root, entry, 'chrome-win', 'chrome.exe'));
    }
  }
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Launch one headless browser and connect to its first page.
 * @param {{ timeoutMs?: number }} [options] - connect timeout.
 * @returns {Promise<{ send: (method: string, params?: any, sessionId?: string) => Promise<any>, close: () => Promise<void> }>} the session.
 */
export async function launchBrowser(options = {}) {
  const binary = findChromium();
  if (binary === undefined) throw new Error('找不到 Chromium（Playwright 浏览器缓存里没有）');
  const port = 9222 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(process.env.TEMP ?? '.', 'dsh-feishu-cdp-'));
  // No `--headless` flag: the preferred binary IS the headless shell, and the
  // full browser is only a fallback (it may fail to start where a crash
  // handler cannot be spawned). `--disable-crash-reporter` keeps the fallback
  // from trying.
  const child = spawn(binary, [
    // `--single-process` plus `--no-sandbox` is what makes a real SPA render
    // inside this restricted sandbox: the multi-process browser cannot start
    // (its internal IPC needs named pipes, which a confined policy denies), and
    // the single-process renderer aborts on the full application unless the
    // sandbox is relaxed. This is a local verification harness pointed at
    // 127.0.0.1 — never a deployment setting.
    '--single-process',
    '--no-zygote',
    '--no-sandbox',
    ...(process.env.DSH_FEISHU_CDP_EXTRA ?? '').split(' ').filter((flag) => flag.length > 0),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });

  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let wsUrl;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const version = await response.json();
      wsUrl = version.webSocketDebuggerUrl;
      if (typeof wsUrl === 'string') break;
    } catch {
      // browser not up yet
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  if (wsUrl === undefined) {
    child.kill();
    throw new Error('浏览器没有暴露 CDP 端口');
  }

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
  });

  let nextId = 1;
  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  const pending = new Map();
  /** Exit code once the browser process is gone, so later commands fail fast. */
  let gone;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
    else waiter.resolve(message.result);
  });
  child.on('exit', (code) => {
    gone = code;
    for (const [, waiter] of pending) waiter.reject(new Error(`浏览器进程已退出（exit=${code}）`));
    pending.clear();
  });

  /**
   * Send one CDP command, bounded by a timeout.
   *
   * A crashed browser answers nothing, so an unbounded await would hang the
   * whole check with no diagnostic — every failure has to name itself.
   */
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (gone !== undefined) {
      reject(new Error(`浏览器进程已退出（exit=${gone}），无法执行 ${method}`));
      return;
    }
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 命令超时：${method}${gone === undefined ? '' : `（浏览器 exit=${gone}）`}`));
    }, options.commandTimeoutMs ?? 30_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params, ...sessionId === undefined ? {} : { sessionId } }));
  });

  // Attach to the about:blank tab the browser opened.
  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find((info) => info.type === 'page');
  if (page === undefined) throw new Error('浏览器没有页面目标');
  const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const session = attached.sessionId;
  await send('Page.enable', {}, session);
  await send('Runtime.enable', {}, session);

  return {
    session,
    send: (method, params, sessionId = session) => send(method, params, sessionId),
    close: async () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      child.kill();
      await new Promise((done) => setTimeout(done, 300));
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
