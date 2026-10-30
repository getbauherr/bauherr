import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneRepo, commitAndPush } from '../src/clone.js';
import { materialise } from '../src/materialise.js';
import { makeBareRepo, makeCtx } from './helpers.js';

test('clone, commit, push to local bare repo; token not persisted; excluded files not committed; cleanup', async () => {
  const base = makeBareRepo();
  const c = await cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 'SECRET-TOKEN', branch: 'bauherr/7-r1' });
  try {
    materialise(c.dir, makeCtx({ gatewayUrl: 'http://x', gitBaseUrl: base }));
    assert.equal(await commitAndPush(c, c.env, 'noop'), false);
    writeFileSync(join(c.dir, 'new.txt'), 'x');
    assert.equal(await commitAndPush(c, c.env, 'add new'), true);
    const bare = base.replace('file://', '') + '/o/n.git';
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'bauherr/7-r1'], { cwd: bare }).toString().split('\n');
    assert.ok(files.includes('new.txt'));
    assert.ok(!files.some((f) => f.startsWith('.bauherr') || f === 'AGENTS.md' || f.startsWith('.claude')));
    assert.ok(!readFileSync(join(c.dir, '.git/config'), 'utf8').includes('SECRET'));
    assert.equal(c.env.GIT_CONFIG_KEY_0, 'http.extraheader');
  } finally {
    await c.cleanup();
  }
  assert.ok(!existsSync(c.dir));
});

test('checkout of an existing branch pushes to that same branch', async () => {
  const base = makeBareRepo();
  const bare = base.replace('file://', '') + '/o/n.git';
  const first = await cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 't', branch: 'bauherr/7-r1' });
  writeFileSync(join(first.dir, 'a.txt'), 'a');
  await commitAndPush(first, first.env, 'first');
  await first.cleanup();
  const c = await cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 't', branch: 'bauherr/7-r2', checkout: 'bauherr/7-r1' });
  try {
    assert.equal(c.branch, 'bauherr/7-r1');
    assert.ok(existsSync(join(c.dir, 'a.txt')));
    writeFileSync(join(c.dir, 'b.txt'), 'b');
    assert.equal(await commitAndPush(c, c.env, 'second'), true);
    assert.ok(execFileSync('git', ['ls-tree', '-r', '--name-only', 'bauherr/7-r1'], { cwd: bare }).toString().includes('b.txt'));
    assert.throws(() => execFileSync('git', ['rev-parse', 'bauherr/7-r2'], { cwd: bare, stdio: 'pipe' }));
  } finally {
    await c.cleanup();
  }
});
