import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneRepo, commitAndPush, interdiff, mergeBase, patchId } from '../src/clone.js';
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

test('clone auth: x-access-token by default, the given user (GitLab oauth2) otherwise', async () => {
  const header = async (user?: string) => {
    const c = await cloneRepo({ baseUrl: makeBareRepo(), repo: 'o/n', defaultBranch: 'main', token: 'T', ...(user ? { user } : {}), branch: 'bauherr/7-r1' });
    await c.cleanup();
    return Buffer.from(c.env.GIT_CONFIG_VALUE_0!.replace('Authorization: Basic ', ''), 'base64').toString();
  };
  assert.equal(await header(), 'x-access-token:T');
  assert.equal(await header('oauth2'), 'oauth2:T');
});

const sh = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();

/** An MR branch with one commit on a.txt, cloned shallow; `moveMain` pushes a commit to main from a second clone. */
async function mrFixture() {
  const base = makeBareRepo();
  const bare = base.replace('file://', '') + '/o/n.git';
  const first = await cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 't', branch: 'bauherr/7-r1' });
  writeFileSync(join(first.dir, 'a.txt'), 'one\ntwo\nthree\n');
  await commitAndPush(first, first.env, 'mr change');
  await first.cleanup();
  const moveMain = (file: string, content: string) => {
    const w = mkdtempSync(join(tmpdir(), 'main-'));
    sh(w, 'clone', '-q', bare, '.');
    writeFileSync(join(w, file), content);
    sh(w, 'add', '-A');
    sh(w, 'commit', '-qm', 'main moves');
    sh(w, 'push', '-q', 'origin', 'main');
  };
  const open = () => cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 't', branch: 'x', checkout: 'bauherr/7-r1' });
  return { bare, moveMain, open };
}

test('mergeBase: up to date, clean (fast-forward push) and conflict; patch-id survives a clean merge', async () => {
  const { bare, moveMain, open } = await mrFixture();
  const c = await open();
  try {
    assert.equal(await mergeBase(c, c.env, 'main'), 'uptodate');
    const id = await patchId(c, c.env, 'main');
    assert.match(id, /^[0-9a-f]{40}$/);
    moveMain('other.txt', 'main only\n');
    assert.equal(await mergeBase(c, c.env, 'main'), 'clean');
    assert.equal(await patchId(c, c.env, 'main'), id);
    assert.equal(await commitAndPush(c, c.env, 'x'), true);
    assert.equal(sh(bare, 'rev-parse', 'bauherr/7-r1'), sh(c.dir, 'rev-parse', 'HEAD'));
    assert.equal(sh(bare, 'rev-list', '--count', 'bauherr/7-r1'), sh(c.dir, 'rev-list', '--count', 'HEAD'));
    writeFileSync(join(c.dir, 'a.txt'), 'changed\n');
    sh(c.dir, 'commit', '-qam', 'real edit');
    assert.notEqual(await patchId(c, c.env, 'main'), id);
  } finally {
    await c.cleanup();
  }
});

test('mergeBase: a conflict leaves the merge in progress; the interdiff shows only the resolution', async () => {
  const { moveMain, open } = await mrFixture();
  const c = await open();
  try {
    const reviewed = sh(c.dir, 'rev-parse', 'HEAD');
    moveMain('a.txt', 'one\nMAIN\nthree\n');
    assert.equal(await mergeBase(c, c.env, 'main'), 'conflict');
    assert.match(readFileSync(join(c.dir, 'a.txt'), 'utf8'), /<<<<<<</);
    assert.ok(existsSync(join(c.dir, '.git/MERGE_HEAD')));
    writeFileSync(join(c.dir, 'a.txt'), 'one\ntwo\nMAIN\nthree\n');
    assert.equal(await commitAndPush(c, c.env, 'resolve'), true);
    const out = join(c.dir, 'inter.patch');
    await interdiff(c, c.env, 'main', reviewed, out);
    const patch = readFileSync(out, 'utf8');
    assert.match(patch, /^[+ ]\+?.*MAIN/m);
    assert.doesNotMatch(patch, /other\.txt/);
    await interdiff(c, c.env, 'main', 'deadbeef', out);
    assert.match(readFileSync(out, 'utf8'), /a\.txt/);
  } finally {
    await c.cleanup();
  }
});
