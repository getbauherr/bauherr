import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentEnv } from '../src/agent.js';
import {
  mkdirAsRunUser,
  readAgentFile,
  RUN_GID,
  RUN_UID,
  runIdentity,
  spawnAsRunUser,
  writeFileAsRunUser,
} from '../src/identity.js';

const asRoot = process.getuid?.() === 0;

const runAsRunUser = (script: string): Promise<string> =>
  new Promise((resolve) => {
    const env = agentEnv(tmpdir(), 'http://127.0.0.1:1');
    const child = spawnAsRunUser({ command: 'sh', args: ['-c', script], env, signal: new AbortController().signal });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('exit', () => resolve(Buffer.concat(chunks).toString()));
  });

await test('without root there is no identity to drop to', { skip: asRoot }, () => {
  assert.equal(runIdentity(), undefined);
});

await test('the dockerfile creates the run user the runner drops to', () => {
  const dockerfile = readFileSync(new URL('../../../../Dockerfile', import.meta.url), 'utf8');
  assert.ok(dockerfile.includes(`--gid ${RUN_GID} runner`));
  assert.ok(dockerfile.includes(`--uid ${RUN_UID} --gid ${RUN_GID}`));
});

await test('a spawned agent is the run user and gets only the allowlist', { skip: !asRoot }, async () => {
  const secret = mkdtempSync(join(tmpdir(), 'secret-'));
  const file = join(secret, 'payload_secret');
  writeFileSync(file, 'hunter2');
  chmodSync(file, 0o600);
  chmodSync(secret, 0o700);
  const ids = 'echo "uid=$(id -u) gid=$(id -g) groups=$(id -G)"';
  const out = await runAsRunUser(
    `${ids}; env | cut -d= -f1; cat ${file} 2>&1; cat /proc/${process.pid}/environ 2>&1`,
  );
  assert.match(out, new RegExp(`uid=${RUN_UID} gid=${RUN_GID} groups=${RUN_GID}\\n`));
  assert.ok(!out.includes('hunter2'));
  assert.equal(out.match(/Permission denied/g)?.length, 2);
  const names = out.split('\n').filter((l) => /^[A-Z_]+$/.test(l));
  const allowed = [...Object.keys(agentEnv('', '')), 'PWD', 'SHLVL', '_'];
  for (const name of names) assert.ok(allowed.includes(name), name);
});

await test('files the worker hands over are owned by the run user', { skip: !asRoot }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hand-'));
  chmodSync(root, 0o777);
  await mkdirAsRunUser(join(root, '.bauherr'));
  await writeFileAsRunUser(join(root, '.bauherr', 'context.json'), '{}\n');
  assert.equal(statSync(join(root, '.bauherr')).uid, RUN_UID);
  assert.equal(statSync(join(root, '.bauherr', 'context.json')).uid, RUN_UID);
  assert.equal(readFileSync(join(root, '.bauherr', 'context.json'), 'utf8'), '{}\n');
});

await test('agent-written files are read without following symlinks and capped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'read-'));
  const folder = join(dir, '.bauherr');
  mkdirSync(folder);
  const target = join(dir, 'secret');
  writeFileSync(target, '{"leak":"hunter2"}');
  writeFileSync(join(folder, 'plain.json'), '{"a":1}');
  symlinkSync(target, join(folder, 'result.json'));
  writeFileSync(join(folder, 'big.json'), 'x'.repeat(2 * 1024 * 1024));
  assert.equal(await readAgentFile(join(folder, 'plain.json')), '{"a":1}');
  assert.equal(await readAgentFile(join(folder, 'result.json')), null);
  assert.equal(await readAgentFile(join(folder, 'big.json')), null);
  assert.equal(await readAgentFile(join(folder, 'missing.json')), null);
  const swapped = mkdtempSync(join(tmpdir(), 'swap-'));
  symlinkSync(folder, join(swapped, '.bauherr'));
  assert.equal(await readAgentFile(join(swapped, '.bauherr', 'plain.json')), null);
});
