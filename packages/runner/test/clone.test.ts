import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneRepo, commitAndPush, git, mergeBase, patchId } from '../src/clone.js';
import { makeBareRepo } from './helpers.js';

await test('clone, commit, push to local bare repo; token not persisted; cleanup', async () => {
  const base = makeBareRepo();
  const c = await cloneRepo({
    baseUrl: base,
    repo: 'o/n',
    defaultBranch: 'main',
    token: 'SECRET-TOKEN',
    branch: 'bauherr/7-r1',
  });
  try {
    assert.equal(await commitAndPush(c, c.env, 'noop'), false);
    writeFileSync(join(c.dir, 'new.txt'), 'x');
    assert.equal(await commitAndPush(c, c.env, 'add new'), true);
    const bare = base.replace('file://', '') + '/o/n.git';
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'bauherr/7-r1'], { cwd: bare })
      .toString()
      .split('\n');
    assert.ok(files.includes('new.txt'));
    assert.ok(!readFileSync(join(c.dir, '.git/config'), 'utf8').includes('SECRET'));
    assert.equal(c.env.GIT_CONFIG_VALUE_0, undefined);
  } finally {
    await c.cleanup();
  }
  assert.ok(!existsSync(c.dir));
});

await test('checkout of an existing branch pushes to that same branch', async () => {
  const base = makeBareRepo();
  const bare = base.replace('file://', '') + '/o/n.git';
  const first = await cloneRepo({
    baseUrl: base,
    repo: 'o/n',
    defaultBranch: 'main',
    token: 't',
    branch: 'bauherr/7-r1',
  });
  writeFileSync(join(first.dir, 'a.txt'), 'a');
  await commitAndPush(first, first.env, 'first');
  await first.cleanup();
  const c = await cloneRepo({
    baseUrl: base,
    repo: 'o/n',
    defaultBranch: 'main',
    token: 't',
    branch: 'bauherr/7-r2',
    checkout: 'bauherr/7-r1',
  });
  try {
    assert.equal(c.branch, 'bauherr/7-r1');
    assert.ok(existsSync(join(c.dir, 'a.txt')));
    writeFileSync(join(c.dir, 'b.txt'), 'b');
    assert.equal(await commitAndPush(c, c.env, 'second'), true);
    assert.ok(
      execFileSync('git', ['ls-tree', '-r', '--name-only', 'bauherr/7-r1'], { cwd: bare }).toString().includes('b.txt'),
    );
    assert.throws(() => execFileSync('git', ['rev-parse', 'bauherr/7-r2'], { cwd: bare, stdio: 'pipe' }));
  } finally {
    await c.cleanup();
  }
});

await test('clone auth: x-access-token by default, the given user (GitLab oauth2) otherwise', async () => {
  const header = async (user?: string) => {
    const c = await cloneRepo({
      baseUrl: makeBareRepo(),
      repo: 'o/n',
      defaultBranch: 'main',
      token: 'T',
      ...(user ? { user } : {}),
      branch: 'bauherr/7-r1',
    });
    await c.cleanup();
    return Buffer.from(c.env.BAUHERR_GIT_AUTH!.replace('Authorization: Basic ', ''), 'base64').toString();
  };
  assert.equal(await header(), 'x-access-token:T');
  assert.equal(await header('oauth2'), 'oauth2:T');
});

const sh = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
    .toString()
    .trim();

async function mrFixture() {
  const base = makeBareRepo();
  const bare = base.replace('file://', '') + '/o/n.git';
  const first = await cloneRepo({
    baseUrl: base,
    repo: 'o/n',
    defaultBranch: 'main',
    token: 't',
    branch: 'bauherr/7-r1',
  });
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
  const open = () =>
    cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 't', branch: 'x', checkout: 'bauherr/7-r1' });
  return { bare, moveMain, open };
}

const MERGE_BASE_CASE =
  'mergeBase: up to date, clean (fast-forward push) and conflict; patch-id survives a clean merge';

await test(MERGE_BASE_CASE, async () => {
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

await test('mergeBase: a conflict leaves the merge in progress until it is resolved', async () => {
  const { moveMain, open } = await mrFixture();
  const c = await open();
  try {
    moveMain('a.txt', 'one\nMAIN\nthree\n');
    assert.equal(await mergeBase(c, c.env, 'main'), 'conflict');
    assert.match(readFileSync(join(c.dir, 'a.txt'), 'utf8'), /<<<<<<</);
    assert.ok(existsSync(join(c.dir, '.git/MERGE_HEAD')));
    writeFileSync(join(c.dir, 'a.txt'), 'one\ntwo\nMAIN\nthree\n');
    assert.equal(await commitAndPush(c, c.env, 'resolve'), true);
  } finally {
    await c.cleanup();
  }
});

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)],
  );

await test('planted git config, hooks and global config run no code and reach no token', async () => {
  const base = makeBareRepo();
  const bare = base.replace('file://', '') + '/o/n.git';
  const c = await cloneRepo({ baseUrl: base, repo: 'o/n', defaultBranch: 'main', token: 'SECRET-TOKEN', branch: 'b' });
  const loot = mkdtempSync(join(tmpdir(), 'loot-'));
  const steal = `sh -c "env > ${loot}/\$\$.txt"`;
  try {
    const own = (path: string, text: string) => writeFileSync(path, text, { flag: 'a' });
    own(join(c.dir, '.git/config'), `[core]\n\tfsmonitor = ${steal}\n\tsshCommand = ${steal}\n\thooksPath = ${loot}\n`);
    own(join(c.dir, '.git/config'), `[credential]\n\thelper = !${steal}\n[remote "origin"]\n\turl = file:///nowhere\n`);
    own(join(c.dir, '.git/config'), `[filter "x"]\n\tclean = ${steal}\n[diff]\n\texternal = ${steal}\n`);
    own(join(c.dir, '.gitattributes'), '* filter=x\n');
    own(join(c.home, '.gitconfig'), `[core]\n\tfsmonitor = ${steal}\n`);
    for (const hook of ['pre-commit', 'post-commit', 'pre-push', 'reference-transaction']) {
      writeFileSync(join(c.dir, '.git/hooks', hook), `#!/bin/sh\nenv > ${loot}/${hook}.txt\n`, { mode: 0o755 });
    }
    mkdirSync(join(c.dir, 'sub'));
    writeFileSync(join(c.dir, 'sub/new.txt'), 'x');
    assert.equal(await commitAndPush(c, c.env, 'planted'), true);
    assert.equal(await patchId(c, c.env, 'main').then((id) => id.length), 40);
    assert.deepEqual(readdirSync(loot), []);
    const pushed = execFileSync('git', ['ls-tree', '-r', '--name-only', 'b'], { cwd: bare }).toString();
    assert.ok(pushed.includes('sub/new.txt'));
    for (const file of filesUnder(c.dir).filter((f) => !f.includes('/.git/objects/'))) {
      assert.ok(!readFileSync(file).includes('SECRET'), file);
    }
  } finally {
    await c.cleanup();
  }
});

await test('local git calls carry no token in config or environment', async () => {
  const c = await cloneRepo({ baseUrl: makeBareRepo(), repo: 'o/n', defaultBranch: 'main', token: 'T', branch: 'b' });
  try {
    assert.ok(!(await git(c.dir, c.env, 'config', '--list')).includes('extraheader'));
    const environment = await git(c.dir, c.env, '-c', 'alias.dump=!env', 'dump');
    assert.ok(environment.includes('GIT_AUTHOR_NAME=Bauherr'));
    assert.ok(!/BAUHERR_GIT_AUTH|GIT_CONFIG_VALUE|Authorization/.test(environment));
  } finally {
    await c.cleanup();
  }
});

await test('a network call sends the token as the authorization header', async () => {
  const seen: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(cloneRepo({ baseUrl, repo: 'o/n', defaultBranch: 'main', token: 'T', branch: 'b' }));
    assert.ok(seen.length > 0);
    assert.ok(seen.every((h) => h === `Basic ${Buffer.from('x-access-token:T').toString('base64')}`));
  } finally {
    server.close();
  }
});
