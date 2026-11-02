import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentEnv } from '../src/agent.js';
import { buildEvidence } from '../src/evidence.js';
import { checkGoal } from '../src/goal.js';
import { egressGuard, writeScopeGuard } from '../src/guards.js';
import { mrBody } from '../src/index.js';
import { materialise } from '../src/materialise.js';
import { makeCtx } from './helpers.js';

const g = (text: string, status: 'unverified' | 'verified' | 'blocked' = 'unverified', reason?: string) => ({ text, status, reason });

test('goal check: block once, then needs_human; blocker ends needs_human; all verified ok', () => {
  assert.equal(checkGoal([g('a', 'verified')], false).kind, 'ok');
  const first = checkGoal([g('a'), g('b', 'verified')], false);
  assert.equal(first.kind, 'block');
  assert.match((first as { reason: string }).reason, /a/);
  assert.equal(checkGoal([g('a')], true).kind, 'needs_human');
  const b = checkGoal([g('a', 'blocked', 'need key')], false);
  assert.deepEqual(b, { kind: 'needs_human', reason: 'a: need key' });
});

test('write scope guard: inside ok, outside/.git/symlink escape denied, owned paths enforced', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'scope-'));
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  mkdirSync(join(cwd, 'src'));
  symlinkSync(outside, join(cwd, 'link'));
  assert.ok(writeScopeGuard(cwd, 'src/new.ts').allow);
  assert.ok(!writeScopeGuard(cwd, '../x').allow);
  assert.ok(!writeScopeGuard(cwd, '/etc/passwd').allow);
  assert.ok(!writeScopeGuard(cwd, 'link/x').allow);
  assert.ok(!writeScopeGuard(cwd, '.git/config').allow);
  assert.ok(!writeScopeGuard(cwd, 'docs/a.md', ['src/**']).allow);
  assert.ok(writeScopeGuard(cwd, 'src/a.ts', ['src/**']).allow);
});

test('egress guard: web tools and network clients denied unless gateway', () => {
  assert.ok(!egressGuard('WebFetch', { url: 'https://x' }, '127.0.0.1:1').allow);
  assert.ok(!egressGuard('Bash', { command: 'curl https://evil' }, '127.0.0.1:1').allow);
  assert.ok(!egressGuard('Bash', { command: 'git push origin x' }, '127.0.0.1:1').allow);
  assert.ok(egressGuard('Bash', { command: 'npm test' }, '127.0.0.1:1').allow);
});

test('agent env carries no gateway key and no process env', () => {
  process.env.SOME_SECRET_FOR_TEST = 'leak';
  const env = agentEnv('/tmp/h', 'http://127.0.0.1:5');
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'HOME', 'PATH']);
  assert.equal(env.ANTHROPIC_API_KEY, 'proxy');
  assert.ok(!JSON.stringify(env).includes('leak'));
  delete process.env.SOME_SECRET_FOR_TEST;
});

test('materialise: skills, AGENTS.md, goal.json, worklog, git-excluded', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'mat-'));
  execFileSync('git', ['init', '-q'], { cwd });
  const ctx = makeCtx({ gatewayUrl: 'http://x', gitBaseUrl: 'file:///x' });
  ctx.ticket.worklog = 'WL-TEXT';
  const md = materialise(cwd, ctx);
  assert.ok(existsSync(join(cwd, '.claude/skills/run-contract/SKILL.md')));
  const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
  assert.equal(agents, md);
  for (const s of ['plan posted', 'WL-TEXT', 'body', 'Egress']) assert.ok(agents.includes(s), s);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.bauherr/goal.json'), 'utf8')), [{ text: 'plan posted', status: 'unverified' }]);
  assert.equal(readFileSync(join(cwd, '.bauherr/worklog.md'), 'utf8'), 'WL-TEXT');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd }).toString(), '');
});

test('evidence lists commands with exit codes and unverified goals', () => {
  const ev = buildEvidence([g('tests pass', 'verified'), g('lint', 'blocked', 'no tool')], [
    { runId: 'r', toolUseId: 't', tool: 'Bash', input: { command: 'npm test' }, ok: false, exitCode: 1 },
    { runId: 'r', toolUseId: 'u', tool: 'Read', input: {}, ok: true },
  ]);
  assert.match(ev, /^## Evidence/);
  assert.match(ev, /`npm test` \| 1 \|/);
  assert.match(ev, /\*\*Not verified\*\*: lint/);
  assert.ok(!ev.includes('Read'));
});

test('MR body references the Ticket without a closing keyword', () => {
  const body = mrBody('https://github.com/o/r/issues/7', '## Evidence');
  assert.match(body, /^Refs https:\/\/github\.com\/o\/r\/issues\/7\n/);
  assert.doesNotMatch(body, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b/i);
});
