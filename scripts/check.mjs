/**
 * One command that proves the plugin is loadable: syntax, dependency links,
 * unit and integration cases, and the profile patch's YAML.
 *
 * Nothing here needs a browser or a running DSH — it is the fast gate to run
 * after every edit, before the slower isolated-profile boot check.
 *
 * Usage: `node scripts/check.mjs`
 *
 * @module dsh-feishu-plugin/scripts/check
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** Run one child process, streaming its output. */
function run(label, args) {
  process.stdout.write(`\n── ${label}\n`);
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
}

/** Syntax-check every shipped source file. */
function checkSyntax() {
  process.stdout.write('\n── syntax\n');
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/feishu.mjs', 'lib/summary.mjs']) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: repoRoot, stdio: 'inherit' });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return false;
    }
    console.log(`  ok   ${file}`);
  }
  return true;
}

/** Verify the bare dependency links the host half needs. */
function checkDependencies() {
  process.stdout.write('\n── dependencies\n');
  let ok = true;
  for (const pkg of ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools', 'yaml']) {
    const path = join(repoRoot, 'node_modules', ...pkg.split('/'));
    if (existsSync(path)) {
      console.log(`  ok   ${pkg}`);
    } else {
      console.error(`  MISS ${pkg} — run: node scripts/bootstrap-deps.mjs`);
      ok = false;
    }
  }
  if (!ok) process.exitCode = 1;
  return ok;
}

const steps = [checkSyntax(), checkDependencies()];
if (steps.every(Boolean)) {
  run('unit + integration cases', ['test/run.mjs']);
}

process.stdout.write(`\n${process.exitCode === undefined || process.exitCode === 0 ? 'check passed' : 'check FAILED'}\n`);
