import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneRepo, commitAndPush, fetchBase, patchId } from '../src/clone.js';
import { makeBareRepo } from './helpers.js';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const open = async (base: string, checkout?: string) =>
  cloneRepo({
    baseUrl: base,
    repo: 'o/n',
    defaultBranch: 'main',
    token: 't',
    branch: 'bauherr/7-r1',
    ...(checkout ? { checkout } : {}),
  });

void test('commitAndPush never commits the work folder', async () => {
  const base = makeBareRepo();
  const c = await open(base);
  try {
    mkdirSync(join(c.dir, '.bauherr'));
    writeFileSync(join(c.dir, '.bauherr/result.json'), '{}');
    writeFileSync(join(c.dir, 'b.txt'), 'b');
    assert.equal(await commitAndPush(c, c.env, 'with work folder'), true);
    const bare = join(base.replace('file://', ''), 'o/n.git');
    const files = sh(bare, 'ls-tree', '-r', '--name-only', 'bauherr/7-r1').split('\n');
    assert.deepEqual(files.sort(), ['README.md', 'b.txt']);
  } finally {
    await c.cleanup();
  }
});

void test('patchId needs the base branch, which fetchBase brings to a branch clone', async () => {
  const base = makeBareRepo();
  const first = await open(base);
  writeFileSync(join(first.dir, 'a.txt'), 'a');
  await commitAndPush(first, first.env, 'a');
  await first.cleanup();
  const c = await open(base, 'bauherr/7-r1');
  try {
    await assert.rejects(patchId(c, c.env, 'main'));
    await fetchBase(c, c.env, 'main');
    assert.match(await patchId(c, c.env, 'main'), /^[0-9a-f]{40}$/);
  } finally {
    await c.cleanup();
  }
});
