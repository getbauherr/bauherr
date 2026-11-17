import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { buildOptions } from '../src/agent.js';
import { DIFF_BUDGET_LINES, diffBudgetWarning, fakeGreenFindings } from '../src/trust.js';
import { makeCtx } from './helpers.js';

const file = (path: string, hunk: string[], head = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`) => `${head}\n@@ -1,9 +1,9 @@\n${hunk.join('\n')}\n`;
const removed = (path: string) => `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-it('a', () => {})\n-it('b', () => {})\n`;

test('fake-green: deleted test file and removed test cases are named with the file and the rule', () => {
  const out = fakeGreenFindings(removed('tests/a.test.ts') + file('e2e/b.spec.ts', ["-test('x', async () => {", "-  expect(1).toBe(1)", "-})", "+  // gone"]));
  assert.equal(out.length, 2);
  assert.match(out[0]!, /^tests\/a\.test\.ts: deletes a test file \(fake-green guard/);
  assert.match(out[1]!, /^e2e\/b\.spec\.ts: removes 1 test case\(s\)/);
});

test('fake-green: moved or replaced test cases net zero, non-test deletions pass', () => {
  assert.deepEqual(fakeGreenFindings(file('tests/a.test.ts', ["-it('a', () => {})", "+it('a renamed', () => {})"])), []);
  assert.deepEqual(fakeGreenFindings(removed('src/a.ts')), []);
});

test('fake-green: a plan line allows the removal of that path, glob included, nothing else', () => {
  const diff = removed('tests/a.test.ts') + removed('tests/b.test.ts');
  assert.equal(fakeGreenFindings(diff, '## Steps\nAllowed: remove tests tests/a.test.ts').length, 1);
  assert.deepEqual(fakeGreenFindings(diff, 'Allowed: remove tests tests/*.test.ts'), []);
  assert.equal(fakeGreenFindings(file('tests/a.test.ts', ["+it.skip('a', () => {})"]), 'Allowed: remove tests tests/a.test.ts').length, 1);
});

test('fake-green: added skip, only, xit and todo in test files', () => {
  for (const line of ["+it.skip('a', f)", "+test.only('a', f)", "+xit('a', f)", "+test.todo('a')", "+describe.skip('a', f)"]) {
    assert.match(fakeGreenFindings(file('tests/a.test.ts', [line]))[0]!, /tests\/a\.test\.ts: adds 1 skipped, only or todo/, line);
  }
  assert.deepEqual(fakeGreenFindings(file('src/a.ts', ["+it.skip('a', f)"])), []);
  assert.deepEqual(fakeGreenFindings(file('tests/a.test.ts', ["-it.skip('a', f)", "+it('a', f)"])), []);
});

test('fake-green: lowered coverage thresholds, lint severity and raised retries in config files', () => {
  const out = fakeGreenFindings(
    file('vitest.config.ts', ['-      lines: 80,', '+      lines: 60,']) +
      file('playwright.config.ts', ['-  retries: 0,', '+  retries: 2,']) +
      file('eslint.config.js', ["-    'no-unused-vars': 'error',", "+    'no-unused-vars': 'off',"]),
  );
  assert.deepEqual(out.map((l) => l.replace(/ \(fake-green guard\)$/, '')), ['vitest.config.ts: lowers the lines threshold from 80 to 60', 'playwright.config.ts: raises retries to 2', 'eslint.config.js: lowers no-unused-vars from error to off']);
  assert.deepEqual(fakeGreenFindings(file('vitest.config.ts', ['-      lines: 60,', '+      lines: 80,'])), []);
});

test('fake-green: reads the GitLab compare format without diff --git headers', () => {
  const gitlab = `--- a/tests/a.test.ts\n+++ b/tests/a.test.ts\n@@ -1,4 +1,2 @@\n-it('a', f)\n-it('b', f)\n x\n y\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-a\n+b`;
  assert.match(fakeGreenFindings(gitlab)[0]!, /^tests\/a\.test\.ts: removes 2 test case\(s\)/);
  assert.equal(fakeGreenFindings(gitlab).length, 1);
});

const added = (path: string, n: number) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${n} @@\n${Array.from({ length: n }, () => '+x').join('\n')}\n`;

test('diff budget: warns above the budget, ignoring lockfiles, generated files and tests', () => {
  assert.equal(diffBudgetWarning(added('src/a.ts', DIFF_BUDGET_LINES)), undefined);
  assert.equal(diffBudgetWarning(added('src/a.ts', DIFF_BUDGET_LINES + 1)), `Large diff (${DIFF_BUDGET_LINES + 1} lines): split per the plan or say why in Evidence`);
  assert.equal(diffBudgetWarning(added('src/a.ts', 100) + added('pnpm-lock.yaml', 900) + added('docs/features.md', 900) + added('apps/server/src/payload-types.ts', 900) + added('tests/a.test.ts', 900)), undefined);
});

test('spin detection: three identical Bash results in a row stop the Run as stuck; a different result or tool resets', async () => {
  const ctx = makeCtx({ gatewayUrl: 'http://x', gitBaseUrl: 'file:///x', stage: 'build' });
  const state: Parameters<typeof buildOptions>[2] = { blockedOnce: false, toolCalls: [], steps: [], results: [], abort: new AbortController() };
  const opts = buildOptions(ctx, { cwd: tmpdir(), home: tmpdir(), proxyUrl: 'http://127.0.0.1:1', agentsMd: '' }, state);
  const ok = opts.hooks!.PostToolUse![0]!.hooks[0]!;
  const ctl = { signal: state.abort.signal };
  const bash = (command: string, out: string) => ok({ hook_event_name: 'PostToolUse', tool_use_id: 't', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: out }, duration_ms: 1 } as never, undefined, ctl);
  await bash('pnpm test', 'a');
  await bash('pnpm test', 'a');
  await bash('pnpm test', 'b');
  await ok({ hook_event_name: 'PostToolUse', tool_use_id: 't', tool_name: 'Edit', tool_input: {}, tool_response: {}, duration_ms: 1 } as never, undefined, ctl);
  await bash('pnpm test', 'b');
  await bash('pnpm test', 'b');
  assert.equal(state.stuck, undefined);
  await bash('pnpm test', 'b');
  assert.match(state.stuck!, /pnpm test.*3 times in a row with exit code 0/);
  assert.ok(state.abort.signal.aborted);

  const failing: typeof state = { blockedOnce: false, toolCalls: [], steps: [], results: [], abort: new AbortController() };
  const fopts = buildOptions(ctx, { cwd: tmpdir(), home: tmpdir(), proxyUrl: 'http://127.0.0.1:1', agentsMd: '' }, failing);
  const f = fopts.hooks!.PostToolUseFailure![0]!.hooks[0]!;
  for (let i = 0; i < 3; i++) await f({ hook_event_name: 'PostToolUseFailure', tool_use_id: 't', tool_name: 'Bash', tool_input: { command: 'make' }, error: 'Exit code 2\nboom', duration_ms: 1 } as never, undefined, { signal: failing.abort.signal });
  assert.match(failing.stuck!, /make.*exit code 2/);
});
