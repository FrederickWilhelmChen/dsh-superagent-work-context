/**
 * Link this plugin's bare runtime dependencies to the DSH installation.
 *
 * The plugin is loaded into a dsh profile by absolute path, so Node resolves
 * its bare specifiers from this directory — not from the DSH installation. The
 * only bare imports the host half needs are `@deepseek-ai/schemastery` (the
 * settings schema) and `@deepseek-ai/dsh-tools` (tool registration).
 *
 * A directory junction is enough on Windows and costs nothing to re-create, so
 * this script is idempotent and safe to run before every boot. It refuses to
 * overwrite a real directory.
 *
 * Usage:
 *   node scripts/bootstrap-deps.mjs            # resolve from `npx @deepseek-ai/dsh`
 *   node scripts/bootstrap-deps.mjs <path>     # resolve from another installation
 *
 * @module dsh-feishu-plugin/scripts/bootstrap-deps
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Packages the plugin imports by name.
 *
 * `schemastery` (the settings schema) and `dsh-tools` (tool registration) are
 * host-half runtime imports; `yaml` is used only by `scripts/apply-profile.mjs`
 * to edit a profile patch without destroying its comments; `dsh` is linked so
 * the isolated boot check can launch the CLI from this repo.
 */
const REQUIRED_PACKAGES = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-tools',
  'yaml',
  '@deepseek-ai/dsh',
];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * Locate the `node_modules` directory of a DSH installation.
 *
 * The default is the npx cache the running GUI was launched from, discovered
 * through the `DSH_*` environment or by scanning the npx cache. An explicit
 * argument always wins.
 *
 * Exported because scripted checks need the same answer: whether a profile
 * bundle resolves at all depends on which installation its host runs from.
 *
 * @param {string | undefined} explicit - user-provided installation root or its node_modules.
 * @returns {string} absolute path to a `node_modules` directory.
 * @throws {Error} when no candidate contains the required packages.
 */
export function findInstallModules(explicit) {
  /** @type {string[]} */
  const candidates = [];
  if (explicit !== undefined) {
    candidates.push(resolve(explicit), join(resolve(explicit), 'node_modules'));
  }
  const npxRoot = join(process.env.LOCALAPPDATA ?? '', 'npm-cache', '_npx');
  if (existsSync(npxRoot)) {
    for (const entry of readdirSync(npxRoot)) {
      candidates.push(join(npxRoot, entry, 'node_modules'));
    }
  }
  candidates.push(join(process.env.APPDATA ?? '', 'npm', 'node_modules'));
  for (const candidate of candidates) {
    if (REQUIRED_PACKAGES.every((pkg) => existsSync(join(candidate, ...pkg.split('/'))))) return candidate;
  }
  throw new Error(
    `找不到包含 ${REQUIRED_PACKAGES.join(', ')} 的 DSH 安装；请把安装目录作为参数传入，例如：`
    + '\n  node scripts/bootstrap-deps.mjs C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\<hash>\\node_modules',
  );
}

/**
 * Create the links this repo's scripts and host half need.
 * @param {string | undefined} explicit - installation root or its node_modules.
 * @returns {void}
 */
function linkDependencies(explicit) {
  const installModules = findInstallModules(explicit);
  const localModules = join(repoRoot, 'node_modules');
  mkdirSync(localModules, { recursive: true });

  for (const pkg of REQUIRED_PACKAGES) {
    const target = join(installModules, ...pkg.split('/'));
    const link = join(localModules, ...pkg.split('/'));
    if (!existsSync(target)) {
      console.error(`跳过 ${pkg}：安装里没有这个包（${target}）`);
      process.exitCode = 1;
      continue;
    }
    mkdirSync(dirname(link), { recursive: true });
    if (existsSync(link)) {
      const stats = lstatSync(link);
      // A Windows junction/directory symlink resolves through `realpathSync`,
      // which is how an already-correct link is recognized (lstat does not
      // reliably report the reparse bit for junctions).
      let real;
      try {
        real = realpathSync(link);
      } catch {
        real = undefined;
      }
      if (real !== undefined && real === realpathSync(target)) {
        console.log(`已就绪 ${pkg} → ${target}`);
        continue;
      }
      if (!stats.isSymbolicLink() && !stats.isDirectory()) {
        console.error(`跳过 ${pkg}：${link} 已存在且不是目录/链接`);
        process.exitCode = 1;
        continue;
      }
      try {
        // unlink removes a directory link itself; rm -r would delete the target.
        unlinkSync(link);
      } catch {
        rmSync(link, { force: true, recursive: true });
      }
    }
    symlinkSync(target, link, 'junction');
    console.log(`链接 ${pkg} → ${target}`);
  }

  console.log(`\n完成。依赖目录：${localModules}`);
}

// Only run as a CLI when invoked directly: the exports above are imported by
// other scripts, which must not trigger a dependency relink as a side effect.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  linkDependencies(process.argv[2]);
}
