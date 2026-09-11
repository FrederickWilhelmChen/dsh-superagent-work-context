/**
 * End-to-end verification in an isolated dsh home.
 *
 * The running GUI at :3080 belongs to the user, so this script never touches
 * it: it builds its own `DSH_HOME` inside the workspace, installs the plugin
 * into a `feishu-dev` profile there, boots `dsh --profile feishu-dev` on a
 * private port, and then proves the plugin actually arrived in the browser:
 *
 *   1. the boot graph names this package;
 *   2. `/plugins/dsh-feishu-plugin/client.js` serves the bundle;
 *   3. the plugin's own JSON API answers;
 *   4. (with `--ui`) a headless browser opens the page, clicks a task row's
 *      「加入输入框」button, and asserts the composer draft changed.
 *
 * Usage: `node scripts/panel-check.mjs [--ui] [--port 3099] [--keep]`
 *
 * @module dsh-feishu-plugin/scripts/panel-check
 */

import { spawn } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProfile } from './apply-profile.mjs';
import { findInstallModules } from './bootstrap-deps.mjs';
import { launchBrowser } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const testHome = join(repoRoot, '.dsh-test');
const profileName = 'feishu-dev';
const profileDir = join(testHome, 'profiles', profileName);
const requestedPort = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 3099);
const withUi = process.argv.includes('--ui');
const keep = process.argv.includes('--keep');
/**
 * The port this run uses.
 *
 * A busy port is the one failure that has nothing to do with the plugin: a
 * stray process left by an earlier run makes `dsh web` exit with EADDRINUSE
 * before anything is verified, and the report then reads like a plugin bug. So
 * the requested port is a starting point — the first free one above it wins.
 * @type {number}
 */
const port = await pickPort(requestedPort);
const baseUrl = `http://127.0.0.1:${port}`;

/**
 * Find a listening-free port at or above the requested one.
 *
 * @param {number} start - the port the caller asked for.
 * @returns {Promise<number>} the first free port within 20 tries.
 */
async function pickPort(start) {
  for (let candidate = start; candidate < start + 20; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.once('listening', () => probe.close(() => done(true)));
      probe.listen(candidate, '127.0.0.1');
    });
    if (free) {
      if (candidate !== start) console.log(`端口 ${start} 被占用，改用 ${candidate}`);
      return candidate;
    }
  }
  throw new Error(`从 ${start} 开始的 20 个端口都被占用了`);
}
/**
 * The first-run launch token the CLI prints in its URL.
 *
 * `dsh web` mints a token and only serves the shell to a request carrying it
 * (or to one that has already exchanged it for a cookie), so every probe here
 * must reuse it.
 * @type {string | undefined}
 */
let launchToken;

/** Locate the dsh CLI entry inside the installation this repo links against. */
function findCli() {
  const modules = join(repoRoot, 'node_modules');
  const candidates = [
    join(modules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(modules, 'dsh', 'lib', 'bin.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Build the isolated home and profile from the real one's shape. */
function prepareHome() {
  rmSync(testHome, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  const realHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh');
  const realProfile = join(realHome, 'profiles', 'web');
  const manifestPath = join(realProfile, 'package.json');
  const fallback = { private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patchReload: 'live' } } };
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : fallback;
  // Copy the user's bundle list only as far as this harness can satisfy it. A
  // bundle resolves from one of three places — this repo's links, the DSH
  // installation, or the profile's own node_modules (where `dsh plugin ...
  // install` puts third-party bundles) — and a scratch profile has only the
  // first two. Keeping an unresolvable row would fail boot for a reason that
  // has nothing to do with the plugin under test.
  const bundles = manifest?.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) {
    // `findInstallModules` throws when it cannot identify an installation; a
    // missing installation only means fewer resolvable bundles here, so the
    // filter degrades instead of failing the whole check.
    let installation;
    try {
      installation = findInstallModules(undefined);
    } catch {
      installation = undefined;
    }    const resolvable = bundles.filter((name) => {
      const segments = String(name).split('/');
      return existsSync(join(repoRoot, 'node_modules', ...segments))
        || (installation !== undefined && existsSync(join(installation, ...segments)))
        || existsSync(join(profileDir, 'node_modules', ...segments));
    });
    const dropped = bundles.filter((name) => !resolvable.includes(name));
    if (dropped.length > 0) console.log(`隔离 profile 跳过无法解析的 bundle：${dropped.join(', ')}`);
    manifest.dsh.profile.bundles = resolvable;
  }
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(profileDir, 'cordis.yml'), '# isolated test root\n[]\n');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# isolated test patch layer\n[]\n');
  writeFileSync(join(testHome, 'settings.yaml'), '{}\n');
  console.log(`隔离 home：${testHome}`);
}

/** Install the plugin row into the isolated profile via the real script. */
function installPatch() {
  // Called in-process: this environment denies the piped stdio that a child
  // process would need. `--force` because the isolated home is built from
  // scratch above — the script's "row already exists" guard is for a user's
  // real profile, where silently rewriting is the thing to avoid.
  const code = applyProfile(['--home', testHome, '--profile', profileName, '--force']);
  if (code !== 0) throw new Error(`apply-profile 返回 ${code}`);
}

/**
 * Pull the boot graph out of a served `index.html`.
 *
 * The graph is injected as a JSON literal after `window.__DSH_BOOT__ =` (the
 * host escapes `<` so plugin-controlled strings cannot break out of the script
 * element). The object is located by brace counting rather than a lazy regex,
 * because the JSON contains nested braces on one line.
 *
 * @param {string} html - served index document.
 * @returns {any | null} the parsed graph, or null when the marker is absent.
 */
function extractBootGraph(html) {
  const marker = html.indexOf('__DSH_BOOT__');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1).replace(/\\u003c/g, '<'));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** One server URL, carrying the launch token when the CLI minted one. */
function url(path) {  const target = new URL(path, baseUrl);
  // The token rides only until a session cookie replaces it: some of these
  // URLs are exact-match keys (a bundle URL carries its own `rev` query), and
  // an extra parameter would turn a match into a 404.
  if (launchToken !== undefined && sessionCookie === undefined) target.searchParams.set('token', launchToken);
  return target.toString();
}

/**
 * Session cookie captured from the token exchange.
 *
 * The shell swaps the URL token for a cookie and then demands the cookie, so a
 * cookie-less probe is answered 401. Node's fetch keeps no jar, so the one
 * `set-cookie` header is remembered here and replayed.
 * @type {string | undefined}
 */
let sessionCookie;

/**
 * Fetch one path, following redirects by hand and remembering the session
 * cookie.
 *
 * Redirects are followed manually because the token exchange is a 303 whose
 * `set-cookie` must be replayed on the next hop — Node's fetch keeps no cookie
 * jar, so letting it follow the chain itself lands on a 401.
 *
 * @param {string} path - path below the server root.
 * @param {RequestInit} [init] - extra request options.
 * @returns {Promise<Response>} the final response.
 */
async function probe(path, init = {}) {
  let target = url(path);
  for (let hop = 0; hop < 6; hop += 1) {
    const headers = { ...init.headers };
    if (sessionCookie !== undefined) headers.cookie = sessionCookie;
    const response = await fetch(target, { ...init, headers, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) sessionCookie = setCookie.split(';')[0];
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || location === null) return response;
    target = new URL(location, baseUrl).toString();
  }
  throw new Error(`重定向过多：${path}`);
}

/**
 * Wait until the server answers, or give up.
 *
 * The probe deliberately carries no token: the launch token is single-use, and
 * spending it here would leave the browser check with nothing to authenticate
 * with. A 401 already proves the socket is accepting requests.
 */
async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      if (response.status > 0) return true;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

/** Assert the boot graph advertises the plugin and serves its bundle. */
async function checkServed() {
  // Reuse the browser's session when the UI check ran; otherwise exchange the
  // launch token here, which is what spends it.
  const response = await probe('/');
  const html = await response.text();
  if (response.status === 401 || html.includes('authentication required')) {
    throw new Error(`首页需要 token（HTTP ${response.status}）：${html.slice(0, 200)}`);
  }
  const boot = extractBootGraph(html);
  if (boot === null) throw new Error(`index.html（${response.status}，${html.length} 字节）里没有 window.__DSH_BOOT__：\n${html.slice(0, 400)}`);
  const ids = boot.entries.map((entry) => entry.id);
  if (!ids.includes('dsh-feishu-plugin')) throw new Error(`boot graph 里没有插件：${ids.slice(0, 8).join(', ')}…`);
  console.log('  ok   boot graph 包含 dsh-feishu-plugin');
  // Fetch the URL the graph itself advertises. The bare `/plugins/<id>/client.js`
  // path 404s by design: the host serves composed one-resource combos, not one
  // file per plugin.
  const row = boot.entries.find((entry) => entry.id === 'dsh-feishu-plugin');
  if (typeof row?.url !== 'string') throw new Error('boot graph 行里没有 url');
  const bundle = await probe(row.url);
  if (!bundle.ok) throw new Error(`bundle ${row.url} 返回 HTTP ${bundle.status}`);
  const source = await bundle.text();
  if (!source.includes('__ModuleLoader__.load')) throw new Error('bundle 不是 DSH 客户端模块格式');
  if (!source.includes("'dsh-feishu-plugin'")) throw new Error('bundle 注册的 id 不是 dsh-feishu-plugin');
  console.log(`  ok   bundle ${bundle.status}（${source.length} 字节，rev=${String(row.rev).slice(0, 12)}…）`);
}

/** Assert the plugin's own API answers. */
async function checkApi() {
  const state = await (await probe('/plugin/feishu/api/state')).json();
  if (state?.ok !== true) throw new Error(`/api/state 返回 ${JSON.stringify(state).slice(0, 200)}`);
  if (state.data?.configured !== false) throw new Error('未配置时 configured 应为 false');
  if (state.data?.settingsNamespace !== 'feishu-plugin') throw new Error('settingsNamespace 不正确');
  console.log(`  ok   /api/state ok（configured=${state.data.configured}, llmAvailable=${state.data.llmAvailable}）`);
  const unknown = await (await probe('/plugin/feishu/api/nope')).json();
  if (unknown?.ok !== false) throw new Error('未知路由应返回 ok:false');
  console.log('  ok   未知路由返回 ok:false');
  // The plugin API must not shadow the harness's own routes.
  const api = await probe('/api/', { method: 'POST' });
  const body = await api.text();
  if (api.status === 404 && body.includes('feishu')) throw new Error('/api 被插件抢占了');
  console.log('  ok   /api 仍由宿主处理');
}

/**
 * Drive the real UI with a headless browser over CDP.
 *
 * This is the acceptance test that matters: a task row's button must append to
 * the live composer's draft. The composer is a Lexical `contenteditable`, so
 * text is typed through `Input.insertText`, which Lexical observes as real
 * input — assigning `.textContent` would bypass its state entirely.
 *
 * @returns {Promise<void>}
 */
async function checkUi() {
  const browser = await launchBrowser();
  try {
    /** Evaluate one expression in the page and return its value. */
    const evaluate = async (expression) => {
      const result = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails !== undefined) {
        throw new Error(`页面脚本异常：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      }
      return result.result.value;
    };

    // Authenticate inside the browser: the shell swaps the URL token for an
    // HttpOnly cookie, which a fresh browser profile has no other way to get.
    // The token is still unspent because every HTTP probe above runs after
    // this navigation completes.
    await browser.send('Page.navigate', { url: url('/') });
    await new Promise((done) => setTimeout(done, 1500));
    await browser.send('Page.navigate', { url: url('/') });

    /** Poll the page until a selector matches. */
    const waitFor = async (selector, timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(`document.querySelector(${JSON.stringify(selector)}) !== null`) === true) return;
        await new Promise((done) => setTimeout(done, 300));
      }
      // A bare timeout is unactionable; report what the page actually shows.
      const diagnostics = await evaluate(`JSON.stringify({
        url: location.href,
        title: document.title,
        text: (document.body?.innerText ?? '').slice(0, 500),
        html: (document.body?.innerHTML ?? '').slice(0, 300),
      })`).catch((error) => `无法读取页面：${error.message}`);
      throw new Error(`等待 ${selector} 超时；页面状态：${diagnostics}`);
    };
    const composer = 'document.querySelector(\'[contenteditable="true"]\')';

    // The composer only exists inside a session; type a baseline first so an
    // overwrite (rather than an append) is detectable.
    await waitFor('[contenteditable="true"]');
    await evaluate(`${composer}.focus()`);
    await browser.send('Input.insertText', { text: '基线文本 ' });
    await new Promise((done) => setTimeout(done, 400));

    // The left rail's Feishu row is the documented way in. The session header
    // button this check used to click was removed on purpose: the rail exists on
    // the home screen too, and the row's page opens this tab and hands the centre
    // column back, so the composer stays where it was.
    const railSelector = '.dsh-feishu-railGlyph';
    await waitFor(railSelector);
    await evaluate(`document.querySelector(${JSON.stringify(railSelector)}).closest('button').click()`);
    // The rail page renders the panel too, and its insertion buttons are inert
    // by construction (no composer in the centre column) — so waiting for an
    // *enabled* insert button waits for the right Sidebar's copy, which is the
    // one that lands beside the conversation.
    const insertSelector = '.dsh-feishu-root .dsh-feishu-btn[data-done="false"]:not([disabled])';
    await waitFor(insertSelector);
    console.log('  ok   左侧栏图标在右侧打开了飞书 Tab');

    // Read the draft again now that the panel is beside it: the hand-off must
    // not have dropped what the user already typed.
    const before = await evaluate(`${composer}.innerText`);
    if (!before.includes('基线文本')) {
      throw new Error(`打开面板后输入框内容丢失：${JSON.stringify(before)}`);
    }
    const rowTitle = await evaluate('document.querySelector(".dsh-feishu-title")?.innerText ?? ""');
    await evaluate(`document.querySelector(${JSON.stringify(insertSelector)}).click()`);
    await new Promise((done) => setTimeout(done, 500));
    const after = await evaluate(`${composer}.innerText`);
    if (after === before) throw new Error(`输入框没有变化（before=${JSON.stringify(before)}）`);
    if (!after.startsWith(before.trim())) throw new Error(`输入框原有内容被覆盖：${JSON.stringify(after)}`);
    console.log(`  ok   「加入输入框」写入成功：${JSON.stringify(after.slice(0, 90))}`);
    if (rowTitle.length > 0) console.log(`  ok   来源行：${rowTitle}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  prepareHome();
  installPatch();
  const cli = findCli();
  if (cli === undefined) throw new Error('找不到 dsh CLI；先运行 node scripts/bootstrap-deps.mjs');
  console.log(`启动 dsh --profile ${profileName} --port ${port} …`);
  // Server output goes to a file rather than a pipe: the sandbox denies the
  // piped stdio a spawned process needs, and a log file is easier to read
  // after a failed boot anyway.
  const logPath = join(testHome, 'server.log');
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [cli, '--profile', profileName, '--port', String(port), '--host', '127.0.0.1', '--no-open'], {
    cwd: repoRoot,
    env: { ...process.env, DSH_HOME: testHome },
    stdio: ['ignore', logFd, logFd],
  });
  let exitCode;
  child.on('exit', (code) => { exitCode = code; });
  const readLog = () => {
    try {
      return readFileSync(logPath, 'utf8');
    } catch {
      return '';
    }
  };
  /** Pick the launch token out of the URL line the CLI prints. */
  const captureToken = () => {
    const match = /https?:\/\/127\.0\.0\.1:\d+\/\?token=([A-Za-z0-9_-]+)/.exec(readLog());
    if (match !== null) launchToken = match[1];
    return match !== null;
  };

  try {
    // Poll both the socket and the log: the token arrives on the URL line,
    // which is printed before the server accepts requests.
    const deadline = Date.now() + 90_000;
    while (launchToken === undefined && Date.now() < deadline) {
      captureToken();
      if (exitCode !== undefined) break;
      await new Promise((done) => setTimeout(done, 250));
    }
    if (launchToken === undefined) {
      throw new Error(`没有拿到启动 token（exit=${exitCode ?? 'running'}）：\n${readLog().slice(-3000)}`);
    }
    if (!await waitForServer()) {
      throw new Error(`服务器没有起来（exit=${exitCode ?? 'running'}）：\n${readLog().slice(-3000)}`);
    }
    console.log('  ok   服务器已就绪（带启动 token）');
    // The browser runs first: it authenticates with the launch token itself,
    // and that token is single-use, so the HTTP probes below must not spend it.
    if (withUi) await checkUi();
    else console.log('  --  跳过浏览器验证（加 --ui 启用）');
    await checkServed();
    await checkApi();
    console.log('\n端到端验证通过');
  } finally {
    child.kill();
    await new Promise((done) => setTimeout(done, 800));
    closeSync(logFd);
    if (!keep) rmSync(testHome, { recursive: true, force: true });
    else console.log(`保留隔离 home：${testHome}`);
  }
}

main().catch((error) => {
  console.error(`\n端到端验证失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
