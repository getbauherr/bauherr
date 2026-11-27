import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv, buildOptions, runAgent, trackSpin, type AgentOptions, type AgentState } from '../src/agent.js';
import { egressGuard, writeScopeGuard } from '../src/guards.js';
import { startProxy } from '../src/proxy.js';
import { handOver, startStubGateway } from './helpers.js';

const freshState = (): AgentState => ({ toolCalls: [], steps: [], results: [], abort: new AbortController() });

const agentOptions = (over: Partial<AgentOptions> = {}): AgentOptions => ({
  runId: 'r1',
  model: 'stub-model',
  cwd: tmpdir(),
  home: tmpdir(),
  proxyUrl: 'http://127.0.0.1:1',
  instructions: '',
  maxTurns: 5,
  maxBudgetUsd: 1,
  ...over,
});

await test('write scope guard: inside ok, outside/.git/symlink escape denied, owned paths enforced', () => {
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

await test('egress guard: web tools and network clients denied unless gateway', () => {
  assert.ok(!egressGuard('WebFetch', { url: 'https://x' }, '127.0.0.1:1').allow);
  assert.ok(!egressGuard('Bash', { command: 'curl https://evil' }, '127.0.0.1:1').allow);
  assert.ok(!egressGuard('Bash', { command: 'git push origin x' }, '127.0.0.1:1').allow);
  assert.ok(egressGuard('Bash', { command: 'npm test' }, '127.0.0.1:1').allow);
});

await test('agent env carries no gateway key and no process env', () => {
  process.env.SOME_SECRET_FOR_TEST = 'leak';
  const env = agentEnv('/tmp/h', 'http://127.0.0.1:5');
  assert.deepEqual(Object.keys(env).sort(), [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    'HOME',
    'LANG',
    'PATH',
    'TMPDIR',
  ]);
  assert.equal(env.ANTHROPIC_API_KEY, 'proxy');
  assert.ok(!JSON.stringify(env).includes('leak'));
  delete process.env.SOME_SECRET_FOR_TEST;
});

const PRESET_KEYS = [
  ...readFileSync(join(import.meta.dirname, '../../../../apps/server/src/lib/providers/shared.ts'), 'utf8')
    .match(/^export type Preset =((?:\s*\|?\s*'[\w-]+')+)/m)![1]
    .matchAll(/'([\w-]+)'/g),
].map((m) => m[1]);
const CLOUD_ENV = /^(AWS_|GOOGLE_|AZURE_|ARM_|ANTHROPIC_(BEDROCK|VERTEX|FOUNDRY)_|CLAUDE_CODE_USE_|CLAUDE_CODE_SKIP_)/;

await test('PRESETS keys are read from providers/shared.ts', () => {
  assert.ok(PRESET_KEYS.length >= 12 && PRESET_KEYS.includes('bedrock-iam') && PRESET_KEYS.includes('foundry-entra'));
});

for (const preset of PRESET_KEYS) {
  await test(`no cloud credentials reach the agent env: ${preset}`, () => {
    const fake = {
      AWS_SECRET_ACCESS_KEY: 'fake-aws',
      GOOGLE_APPLICATION_CREDENTIALS: '/fake/gcp.json',
      ANTHROPIC_FOUNDRY_API_KEY: 'fake-foundry',
    };
    Object.assign(process.env, fake);
    try {
      const env = buildOptions(agentOptions({ model: `${preset}/some-model` }), freshState()).env as Record<
        string,
        string
      >;
      assert.deepEqual(Object.keys(env).sort(), [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        'HOME',
        'LANG',
        'PATH',
        'TMPDIR',
      ]);
      assert.deepEqual(
        Object.keys(env).filter((k) => CLOUD_ENV.test(k)),
        [],
      );
      for (const v of Object.values(fake)) assert.ok(!JSON.stringify(env).includes(v));
    } finally {
      for (const k of Object.keys(fake)) delete process.env[k];
    }
  });
}

await test('a read-only agent has no shell and no Edit, and writes only its writable paths', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ro-'));
  mkdirSync(join(cwd, 'src'));
  const state = freshState();
  const opts = buildOptions(agentOptions({ cwd, home: cwd, readOnly: true, writablePaths: ['.bauherr/'] }), state);
  assert.deepEqual(opts.tools, ['Read', 'Grep', 'Glob', 'Write']);
  const write = opts.hooks!.PreToolUse![0].hooks[0];
  const decide = async (file: string) => {
    const input: PreToolUseHookInput = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: file },
      tool_use_id: 'tool-use-1',
      session_id: 'session-1',
      transcript_path: '',
      cwd,
    };
    const out = (await write(input, undefined, { signal: state.abort.signal })) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    return out.hookSpecificOutput.permissionDecision;
  };
  assert.equal(await decide(join(cwd, '.bauherr/out.json')), 'allow');
  assert.equal(await decide(join(cwd, 'src/a.ts')), 'deny');
});

await test('spin tracking: the third identical failing command in a row is a spin, another tool resets it', () => {
  const state = freshState();
  const run = () => trackSpin(state, 'Bash', { command: 'npm test' }, 1, 'boom');
  assert.equal(run(), undefined);
  assert.equal(run(), undefined);
  assert.match(run() ?? '', /Spinning: `npm test` ran 3 times/);
  trackSpin(state, 'Read', {}, 0, '');
  assert.equal(run(), undefined);
});

await test(
  'runAgent through the proxy: the gateway key is injected upstream, one Step per message',
  { timeout: 120_000 },
  async () => {
    const gw = await startStubGateway('I am done.');
    const proxy = await startProxy({ gatewayUrl: gw.url, gatewayKey: 'REAL-GATEWAY-KEY', runId: 'r1', stage: 'build' });
    const cwd = handOver(mkdtempSync(join(tmpdir(), 'agent-')));
    const state = freshState();
    try {
      await runAgent(
        'r1',
        buildOptions(agentOptions({ cwd, home: cwd, proxyUrl: proxy.url, readOnly: true }), state),
        'Say done.',
        state,
      );
      assert.equal(state.result?.subtype, 'success');
      assert.ok(gw.seen.length >= 1);
      for (const s of gw.seen) {
        assert.equal(s.headers.authorization, 'Bearer REAL-GATEWAY-KEY');
        assert.equal(s.headers['x-bauherr-run'], 'r1');
      }
      assert.ok(state.steps.length >= 1);
      assert.equal(new Set(state.steps.map((s) => s.messageId)).size, state.steps.length);
      assert.ok(state.steps.every((s) => s.inputTokens > 0 && s.runId === 'r1'));
    } finally {
      await proxy.close();
      await gw.close();
    }
  },
);
