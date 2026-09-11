/**
 * Run every test module in this directory in-process.
 *
 * Usage: `node test/run.mjs [name-filter]`
 *
 * @module dsh-feishu-plugin/test/run
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const modules = readdirSync(here)
  .filter((entry) => entry.endsWith('.test.mjs'))
  .filter((entry) => filter === undefined || entry.includes(filter))
  .sort();

if (modules.length === 0) {
  console.error(`没有找到测试模块（filter=${filter ?? 'none'}）`);
  process.exit(1);
}

/** @type {Array<any>} */
const cases = [];
for (const file of modules) {
  const loaded = await import(new URL(`./${file}`, import.meta.url));
  if (!Array.isArray(loaded.cases)) {
    console.error(`${file} 没有 export cases`);
    process.exit(1);
  }
  cases.push(...loaded.cases);
}

console.log(`运行 ${cases.length} 个用例（${modules.length} 个模块）\n`);
process.exitCode = await run(cases);
