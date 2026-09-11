/**
 * Install (or update) this plugin in a dsh profile's user patch layer.
 *
 * A profile is composed from bundle layers plus the user's own
 * `$DSH_HOME/profiles/<name>/cordis.patch.yml`, and an `insert` row there may
 * name a package by absolute path — the loader converts it to a file URL at
 * boot (`dsh-app-boot/README.md`). This script performs exactly that edit,
 * idempotently, with a backup, and prints the resulting document.
 *
 * The document is edited through the YAML AST so the user's comments and
 * formatting survive; only the one `insert` list changes.
 *
 * Usage:
 *   node scripts/apply-profile.mjs                 # install into profile `web`
 *   node scripts/apply-profile.mjs --dry-run       # print the result, write nothing
 *   node scripts/apply-profile.mjs --profile web --home C:\Users\me\.dsh
 *   node scripts/apply-profile.mjs --config appId=cli_x,baseUrl=https://open.larksuite.com
 *
 * @module dsh-feishu-plugin/scripts/apply-profile
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
/** Row id the patch targets; also the settings namespace. */
export const ROW_ID = 'feishu-plugin';

/**
 * Resolve this package's loader entry point.
 *
 * The loader imports the row's `name` as an ES module, and Node refuses a
 * directory import — so the row must name the entry FILE. `package.json`'s
 * `main` is the authority; `lib/index.js` is the documented fallback.
 *
 * @returns {string} absolute path of the host entry module.
 */
function resolveEntry() {
  const manifestPath = join(repoRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const main = typeof manifest.main === 'string' && manifest.main.length > 0 ? manifest.main : './lib/index.js';
  return resolve(repoRoot, main);
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
 * Parse `--config a=b,c=d` into a config object, coercing booleans.
 * @param {unknown} value - the flag value.
 * @returns {Record<string, unknown> | undefined} config entries, when given.
 */
function parseConfigFlag(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  /** @type {Record<string, unknown>} */
  const config = {};
  for (const pair of value.split(',')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const raw = pair.slice(index + 1).trim();
    config[key] = raw === 'true' ? true : raw === 'false' ? false : raw;
  }
  return Object.keys(config).length === 0 ? undefined : config;
}

/**
 * Apply the plugin row to a profile patch layer.
 *
 * Exported so an orchestrator (the isolated boot check) can call it in-process:
 * this environment denies the piped stdio a child process would need.
 *
 * @param {string[]} argv - CLI arguments, without the node/script prefix.
 * @returns {number} process exit code.
 */
export function applyProfile(argv) {
const flags = parseArgs(argv);
const profileName = typeof flags.profile === 'string' ? flags.profile : 'web';
const home = typeof flags.home === 'string'
  ? flags.home
  : (process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh'));
const profileDir = join(home, 'profiles', profileName);
const patchPath = join(profileDir, 'cordis.patch.yml');
const dryRun = flags['dry-run'] === true;
const force = flags.force === true;
const config = parseConfigFlag(flags.config);

if (!existsSync(profileDir)) {
  console.error(`找不到 profile 目录：${profileDir}`);
  console.error('先运行一次 `dsh --profile web` 让它自动初始化，或用 --profile / --home 指定。');
  return 1;
}

const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n';
const document = parseDocument(original);
if (document.errors.length > 0) {
  console.error(`${patchPath} 不是合法 YAML：`);
  for (const error of document.errors) console.error(`  ${error.message}`);
  return 1;
}
const rows = document.toJS();
if (rows !== null && !Array.isArray(rows)) {
  console.error(`${patchPath} 的顶层必须是 YAML 数组（patch 列表）。`);
  return 1;
}
/** @type {any[]} */
const list = Array.isArray(rows) ? rows : [];

/** The row this plugin owns, wherever it currently sits. */
let owner = list.find((entry) => entry !== null && typeof entry === 'object' && Array.isArray(entry.insert)
  && entry.insert.some((inner) => inner?.id === ROW_ID));

if (owner !== undefined && !force && config === undefined) {
  console.log(`${patchPath} 里已经有 ${ROW_ID} 这一行：\n${JSON.stringify(owner.insert.find((inner) => inner?.id === ROW_ID), null, 2)}`);
  console.log('\n没有传入 --config，文件未改动。要覆盖请加 --force。');
  return 0;
}

const newRow = { id: ROW_ID, name: resolveEntry(), ...config === undefined ? {} : { config } };
if (owner === undefined) {
  owner = list.find((entry) => entry !== null && typeof entry === 'object' && Array.isArray(entry.insert));
  if (owner === undefined) {
    owner = { insert: [] };
    list.push(owner);
  }
  owner.insert.push(newRow);
} else {
  owner.insert = owner.insert.map((inner) => (inner?.id === ROW_ID ? { ...inner, ...newRow } : inner));
}

/** One `insert` list as YAML text, indented under its parent key. */
function renderInsert(rows) {
  const lines = ['- insert:'];
  for (const entry of rows) {
    lines.push(`    - id: ${entry.id}`);
    // Quoted file URL rather than a Windows path: the loader accepts both, and
    // a URL sidesteps YAML backslash escaping. It also needs quotes because a
    // bare scalar containing `:` is ambiguous to a YAML parser.
    lines.push(`      name: ${JSON.stringify(pathToFileURL(entry.name).href)}`);
    if (entry.config !== undefined && Object.keys(entry.config).length > 0) {
      lines.push('      config:');
      for (const [key, value] of Object.entries(entry.config)) {
        lines.push(`        ${key}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Apply the plugin row to the patch text, preserving the author's comments.
 *
 * The whole `insert` region is re-rendered as text rather than rebuilt through
 * the YAML AST: text keeps every leading `#` comment, which a root-node
 * replacement drops. Only the region from the first `- insert:` down is
 * rewritten, so plain override rows above it survive verbatim.
 *
 * A brand-new profile file is a header comment plus `[]`; that empty-document
 * placeholder must not be left behind, because a document holding both `[]`
 * and an insert list is invalid YAML.
 *
 * @param {string} text - current patch document.
 * @param {any[]} currentList - rows, including the plugin's own list.
 * @returns {string} the new document.
 */
function renderPatch(text, currentList) {
  const lists = currentList.filter((entry) => entry !== null && typeof entry === 'object' && Array.isArray(entry.insert));
  const insertIndex = text.indexOf('- insert:');
  const beforeInsert = insertIndex === -1 ? text : text.slice(0, insertIndex);
  // Keep the author's comments; drop the empty-document placeholder.
  const head = beforeInsert
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '[]' && line.trim() !== 'null')
    .join('\n')
    .replace(/\s*$/, '');
  const blocks = lists.map((entry) => renderInsert(entry.insert));
  return `${[head, ...blocks].filter((part) => part.length > 0).join('\n\n')}\n`;
}

const output = renderPatch(original, list);

if (dryRun) {
  console.log(`将要写入 ${patchPath}：\n`);
  console.log(output);
  console.log('（dry-run：未写入文件）');
  return 0;
}

if (!existsSync(patchPath)) {
  mkdirSync(profileDir, { recursive: true });
  console.log(`创建 ${patchPath}`);
} else {
  copyFileSync(patchPath, `${patchPath}.bak`);
  console.log(`已备份到 ${patchPath}.bak`);
}
writeFileSync(patchPath, output, 'utf8');
console.log(`已写入 ${patchPath}\n`);
console.log(output);
console.log('\n下一步：重启 `dsh web`（新插件首次装载必须重启），然后刷新页面。');
console.log('App ID / App Secret 可以直接在「设置 → 插件配置 → feishu-plugin」里填，不必写进 YAML。');
  return 0;
}

// Only run as a CLI when invoked directly.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = applyProfile(process.argv.slice(2));
}
