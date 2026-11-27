import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentEnv } from '../src/agent.js';
import { cloneRepo } from '../src/clone.js';
import {
  claimIdentity,
  FIRST_RUN_UID,
  killRunProcesses,
  mkdirAsRunUser,
  readAgentFile,
  releaseIdentity,
  RUN_SLOTS,
  runIdentity,
  spawnAsRunUser,
  writeFileAsRunUser,
} from '../src/identity.js';
import { handOver, makeBareRepo } from './helpers.js';

const asRoot = process.getuid?.() === 0;

const runAsRunUser = (cwd: string, script: string): Promise<string> =>
  new Promise((resolve) => {
    const env = agentEnv(cwd, 'http://127.0.0.1:1');
    const signal = new AbortController().signal;
    const child = spawnAsRunUser({ command: 'sh', args: ['-c', script], cwd, env, signal });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('exit', () => resolve(Buffer.concat(chunks).toString()));
  });

await test('without root there is no identity to drop to', { skip: asRoot }, () => {
  assert.equal(runIdentity(tmpdir()), undefined);
  assert.equal(claimIdentity(tmpdir()), undefined);
});

await test('the dockerfile creates the run user the runner drops to', () => {
  const dockerfile = readFileSync(new URL('../../../../Dockerfile', import.meta.url), 'utf8');
  assert.ok(dockerfile.includes(`seq 0 ${RUN_SLOTS - 1}`));
  assert.ok(dockerfile.includes(`$((${FIRST_RUN_UID}+i))`));
});

await test('every run claims its own identity and an unclaimed path is refused', { skip: !asRoot }, () => {
  const roots = ['/x/a', '/x/b'];
  const ids = roots.map((r) => claimIdentity(r)!);
  try {
    assert.notEqual(ids[0].uid, ids[1].uid);
    assert.equal(runIdentity('/x/a/repo/file')?.uid, ids[0].uid);
    assert.equal(runIdentity('/x/b')?.uid, ids[1].uid);
    assert.throws(() => runIdentity('/x/ab'), /no run identity/);
  } finally {
    roots.forEach(releaseIdentity);
  }
  assert.equal(claimIdentity('/x/c')?.uid, ids[0].uid);
  releaseIdentity('/x/c');
});

await test('a spawned agent is the run user and gets only the allowlist', { skip: !asRoot }, async () => {
  const secret = mkdtempSync(join(tmpdir(), 'secret-'));
  const file = join(secret, 'payload_secret');
  writeFileSync(file, 'hunter2');
  chmodSync(file, 0o600);
  chmodSync(secret, 0o700);
  const ids = 'echo "uid=$(id -u) gid=$(id -g) groups=$(id -G)"';
  const home = handOver(mkdtempSync(join(tmpdir(), 'home-')));
  const uid = runIdentity(home)!.uid;
  const out = await runAsRunUser(
    home,
    `${ids}; env | cut -d= -f1; cat ${file} 2>&1; cat /proc/${process.pid}/environ 2>&1`,
  );
  assert.match(out, new RegExp(`uid=${uid} gid=${uid} groups=${uid}\\n`));
  assert.ok(!out.includes('hunter2'));
  assert.equal(out.match(/Permission denied/g)?.length, 2);
  const names = out.split('\n').filter((l) => /^[A-Z_]+$/.test(l));
  const allowed = [...Object.keys(agentEnv('', '')), 'PWD', 'SHLVL', '_'];
  for (const name of names) assert.ok(allowed.includes(name), name);
});

await test('files the worker hands over are owned by the run user', { skip: !asRoot }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hand-'));
  chmodSync(root, 0o777);
  handOver(root);
  await mkdirAsRunUser(join(root, '.bauherr'));
  await writeFileAsRunUser(join(root, '.bauherr', 'context.json'), '{}\n');
  const { uid } = runIdentity(root)!;
  assert.equal(statSync(join(root, '.bauherr')).uid, uid);
  assert.equal(statSync(join(root, '.bauherr', 'context.json')).uid, uid);
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

await test('two concurrent runs cannot read or write each other', { skip: !asRoot }, async () => {
  const [a, b] = await Promise.all(['o/n', 'o/n'].map((repo) =>
    cloneRepo({ baseUrl: makeBareRepo(), repo, defaultBranch: 'main', token: 'T', branch: 'bauherr/1-r' }),
  ));
  try {
    assert.notEqual(runIdentity(a.dir)!.uid, runIdentity(b.dir)!.uid);
    assert.equal(statSync(a.dir).uid, runIdentity(a.dir)!.uid);
    const attempt = (own: string, other: string) =>
      runAsRunUser(own, `ls ${other} 2>&1; cat ${other}/README.md 2>&1; { echo x > ${other}/planted; } 2>&1; id -u`);
    for (const [own, other] of [[a.dir, b.dir], [b.dir, a.dir]]) {
      const out = await attempt(own, other);
      assert.equal(out.match(/Permission denied/g)?.length, 3, out);
      assert.ok(!existsSync(join(other, 'planted')));
    }
  } finally {
    await Promise.all([a.cleanup(), b.cleanup()]);
  }
});

await test('leftover processes of a run are killed before its uid is reused', { skip: !asRoot }, async () => {
  const c = await cloneRepo({ baseUrl: makeBareRepo(), repo: 'o/n', defaultBranch: 'main', token: 'T', branch: 'b' });
  try {
    const out = await runAsRunUser(c.dir, 'sleep 300 >/dev/null 2>&1 & echo $!');
    const pid = Number(out.trim());
    process.kill(pid, 0);
    await killRunProcesses(c.dir);
    await new Promise((r) => setTimeout(r, 200));
    assert.throws(() => process.kill(pid, 0));
  } finally {
    await c.cleanup();
  }
});
