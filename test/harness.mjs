/**
 * A tiny zero-dependency test harness.
 *
 * Node's built-in `node --test` runner spawns one child process per file, and
 * this environment's sandbox denies the piped stdio that spawn needs. A
 * collector plus an in-process runner keeps the suite runnable here and keeps
 * the plugin free of any dependency (there is no package manager step either).
 *
 * @module dsh-feishu-plugin/test/harness
 */

/**
 * Create the collector one test module exports its cases through.
 * @param {string} suite - suite name, printed in the report.
 * @returns {{ test: (name: string, fn: () => void | Promise<void>) => void, cases: Array<{ suite: string, name: string, fn: Function }> }} collector.
 */
export function suite(suite) {
  const cases = [];
  return {
    cases,
    /**
     * Register one case.
     * @param {string} name - case name.
     * @param {() => void | Promise<void>} fn - case body; a throw is a failure.
     */
    test(name, fn) {
      cases.push({ suite, name, fn });
    },
  };
}

/**
 * Run every collected case, isolating failures.
 * @param {Array<{ suite: string, name: string, fn: Function }>} cases - cases from every module.
 * @returns {Promise<number>} process exit code.
 */
export async function run(cases) {
  let failed = 0;
  let passed = 0;
  for (const testCase of cases) {
    try {
      await testCase.fn();
      passed += 1;
      console.log(`  ok   ${testCase.suite} › ${testCase.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${testCase.suite} › ${testCase.name}`);
      console.error(`       ${error instanceof Error ? error.stack?.split('\n').slice(0, 4).join('\n       ') : String(error)}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${cases.length} total`);
  return failed === 0 ? 0 : 1;
}
