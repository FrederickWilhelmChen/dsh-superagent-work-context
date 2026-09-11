/**
 * Write this plugin's credentials into the user-settings document.
 *
 * The Host serves a settings namespace as soon as the plugin registers one, but
 * the Web settings page only draws a card for a namespace it has a card for —
 * and that page ships cards only for its own built-in plugins, with no
 * schema-driven fallback. So the supported path for a third-party plugin is the
 * settings document itself, which the provider hot-reloads:
 *
 *   `$DSH_HOME/settings.yaml` → `feishu-plugin:` section
 *
 * This script writes that section for you, and touches nothing else in the file.
 *
 * Usage:
 *   node scripts/apply-settings.mjs --show
 *   node scripts/apply-settings.mjs --app-id cli_xxx --app-secret yyy
 *   node scripts/apply-settings.mjs --app-id cli_xxx --from-file secret.txt
 *   node scripts/apply-settings.mjs --set baseUrl=https://open.larksuite.com
 *
 * @module dsh-feishu-plugin/scripts/apply-settings
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

/** Namespace the plugin registers; also the YAML section key. */
export const NAMESPACE = 'feishu-plugin';

/**
 * Render the plugin's section as a block-YAML fragment.
 *
 * The provider writes block YAML for every other namespace, and a one-line JSON
 * flow mapping would be a visible oddity in a file users read and edit.
 * @param {Record<string, unknown>} values - section entries.
 * @returns {string} YAML text.
 */
export function renderSection(values) {
  const lines = [`${NAMESPACE}:`];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`  ${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
  }
  return lines.join('\n');
}

/**
 * Replace this plugin's section in the document text, leaving every other
 * namespace exactly as its author wrote it.
 *
 * A text rewrite is safe here because the section is keyed by the plugin's own
 * name: only lines belonging to `feishu-plugin:` are moved, so
 * `agent-default-model:` and friends keep their formatting and comments.
 * @param {string} text - current document text.
 * @param {Record<string, unknown>} values - the section to write.
 * @returns {string} the new document text.
 */
export function replaceSection(text, values) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const topLevelKey = /^([A-Za-z0-9_-]+):/.exec(line);
    if (topLevelKey !== null) skipping = topLevelKey[1] === NAMESPACE;
    if (skipping) continue;
    // Drop the placeholder an empty document carries.
    if (line.trim() === '{}' || line.trim() === 'null') continue;
    kept.push(line);
  }
  const head = kept.join('\n').replace(/\s*$/, '');
  return `${[head, renderSection(values)].filter((part) => part.length > 0).join('\n\n')}\n`;
}

/** Minimal flag parser: `--name value` and `--flag`. */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

/**
 * Write (or report) this plugin's settings section.
 * @param {string[]} argv - arguments without the node/script prefix.
 * @returns {number} process exit code.
 */
export function applySettings(argv) {
  const flags = parseArgs(argv);
  const home = typeof flags.home === 'string'
    ? flags.home
    : (process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh'));
  const settingsPath = join(home, 'settings.yaml');

  /** Read the current document; a missing file is an empty document. */
  function readDocument() {
    if (!existsSync(settingsPath)) return { document: parseDocument('{}\n'), raw: '{}\n' };
    const raw = readFileSync(settingsPath, 'utf8');
    const document = parseDocument(raw);
    if (document.errors.length > 0) {
      console.error(`${settingsPath} 不是合法 YAML：`);
      for (const error of document.errors) console.error(`  ${error.message}`);
      return undefined;
    }
    return { document, raw };
  }

  const loaded = readDocument();
  if (loaded === undefined) return 1;
  const all = loaded.document.toJS() ?? {};
  const section = all[NAMESPACE] !== null && typeof all[NAMESPACE] === 'object' ? all[NAMESPACE] : {};

  const wantsWrite = typeof flags['app-id'] === 'string' || typeof flags['app-secret'] === 'string'
    || typeof flags['from-file'] === 'string' || typeof flags.set === 'string';
  if (flags.show === true || !wantsWrite) {
    console.log(`设置文档：${settingsPath}`);
    console.log(`存在：${existsSync(settingsPath)}`);
    console.log(`\n${NAMESPACE} 段：`);
    if (Object.keys(section).length === 0) {
      console.log('  （还没有配置。用 --app-id / --app-secret 写入，或 --set key=value）');
    } else {
      for (const [key, value] of Object.entries(section)) {
        // Never echo a secret back, not even a masked prefix of one.
        const shown = /secret|token/i.test(key) && typeof value === 'string' && value.length > 0
          ? `<已设置，${value.length} 字符>`
          : JSON.stringify(value);
        console.log(`  ${key}: ${shown}`);
      }
    }
    return 0;
  }

  /** @type {Record<string, unknown>} */
  const patch = {};
  if (typeof flags['app-id'] === 'string') patch.appId = flags['app-id'];
  if (typeof flags['app-secret'] === 'string') patch.appSecret = flags['app-secret'];
  if (typeof flags['from-file'] === 'string') {
    if (!existsSync(flags['from-file'])) {
      console.error(`找不到文件：${flags['from-file']}`);
      return 1;
    }
    patch.appSecret = readFileSync(flags['from-file'], 'utf8').trim();
  }
  for (const pair of typeof flags.set === 'string' ? flags.set.split(',') : []) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    patch[key] = value === 'true' ? true : value === 'false' ? false : (/^\d+$/.test(value) ? Number(value) : value);
  }
  if (Object.keys(patch).length === 0) {
    console.error('没有要写入的内容。用 --app-id / --app-secret / --set key=value。');
    return 1;
  }

  const rendered = replaceSection(loaded.raw, { ...section, ...patch });
  if (flags['dry-run'] === true) {
    console.log(`将要写入 ${settingsPath}：\n`);
    console.log(rendered);
    console.log('（dry-run：未写入文件）');
    return 0;
  }

  writeFileSync(settingsPath, rendered, 'utf8');
  console.log(`已写入 ${settingsPath}\n`);
  console.log(rendered);
  console.log('\nsettings.yaml 是热加载的：正在运行的 dsh web 会直接读到新值，不用重启。');
  console.log('回到右侧边栏的「飞书」Tab，点「刷新」即可。');
  return 0;
}

// Only run as a CLI when invoked directly.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = applySettings(process.argv.slice(2));
}
