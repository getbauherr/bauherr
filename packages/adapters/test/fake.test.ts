import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeBackend } from '../src/index.js';
import { contractSuite } from './contract.js';

for (const native of [true, false]) {
  const backend = new FakeBackend({ native, user: 'octo' });
  contractSuite(`fake (${native ? 'native' : 'body-convention'})`, {
    backend, repo: 'acme/app', user: 'octo',
    commitFile: async (branch, path, content) => {
      backend.commit('acme/app', branch, path, content);
    },
    enableQueue: () => backend.setQueueSupport('acme/app', true),
  });
}

describe('fake: releases', () => {
  it('lists releases newest first; a commit is its own ancestor, others only when set', async () => {
    const b = new FakeBackend();
    b.addRelease('o/r', { tag: 'v1', sha: 'a' });
    b.addRelease('o/r', { tag: 'v2', sha: 'b' });
    assert.deepEqual((await b.forge.listReleases('o/r')).map((r) => r.tag), ['v2', 'v1']);
    assert.equal(await b.forge.isAncestor('o/r', 'a', 'a'), true);
    assert.equal(await b.forge.isAncestor('o/r', 'a', 'b'), false);
    b.setAncestors('o/r', 'b', ['a']);
    assert.equal(await b.forge.isAncestor('o/r', 'a', 'b'), true);
  });
});

describe('fake: mergePullRequest', () => {
  const setup = async () => {
    const b = new FakeBackend();
    await b.forge.createBranch('o/r', 'feat');
    b.commit('o/r', 'feat', 'a.txt', 'a');
    const pr = await b.forge.openPullRequest('o/r', { title: 't', head: 'feat', base: 'main' });
    return { b, pr };
  };
  it('squash-merges, records the merge sha and deletes the branch', async () => {
    const { b, pr } = await setup();
    const { mergeSha } = await b.forge.mergePullRequest('o/r', pr.number, { method: 'squash', deleteBranch: true });
    const merged = await b.forge.getPullRequest('o/r', pr.number);
    assert.equal(merged.state, 'merged');
    assert.equal(merged.mergeSha, mergeSha);
    assert.ok(!(await b.forge.listBranches('o/r')).some((x) => x.name === 'feat'));
  });
  it('retargets the PRs stacked on the deleted head branch to the merged PR base', async () => {
    const { b, pr } = await setup();
    await b.forge.createBranch('o/r', 'child', 'feat');
    const child = await b.forge.openPullRequest('o/r', { title: 'c', head: 'child', base: 'feat' });
    await b.forge.mergePullRequest('o/r', pr.number, { method: 'squash', deleteBranch: true });
    assert.deepEqual(await b.forge.getPullRequest('o/r', child.number).then((p) => [p.state, p.base]), ['open', 'main']);
  });
  it('refuses a moved head and a PR that is not open', async () => {
    const { b, pr } = await setup();
    await assert.rejects(b.forge.mergePullRequest('o/r', pr.number, { method: 'squash', expectSha: 'stale' }), /head moved/);
    await b.forge.mergePullRequest('o/r', pr.number, { method: 'squash' });
    await assert.rejects(b.forge.mergePullRequest('o/r', pr.number, { method: 'squash' }), /merged/);
  });
});

describe('fake: closePullRequest', () => {
  it('closes an open PR and leaves a merged one merged', async () => {
    const b = new FakeBackend();
    await b.forge.createBranch('o/r', 'feat');
    const pr = await b.forge.openPullRequest('o/r', { title: 't', head: 'feat', base: 'main' });
    await b.forge.closePullRequest('o/r', pr.number);
    assert.equal((await b.forge.getPullRequest('o/r', pr.number)).state, 'closed');
  });
});

describe('fake: mergeable', () => {
  it('setMergeable(false) makes the merge throw; a new commit on the head resets it', async () => {
    const b = new FakeBackend();
    await b.forge.createBranch('o/r', 'feat');
    b.commit('o/r', 'feat', 'a.txt', 'a');
    const pr = await b.forge.openPullRequest('o/r', { title: 't', head: 'feat', base: 'main' });
    b.setMergeable('o/r', pr.number, false);
    assert.equal((await b.forge.getPullRequest('o/r', pr.number)).mergeable, false);
    await assert.rejects(b.forge.mergePullRequest('o/r', pr.number, { method: 'squash' }), /cleanly/);
    b.commit('o/r', 'feat', 'a.txt', 'b');
    assert.equal((await b.forge.getPullRequest('o/r', pr.number)).mergeable, undefined);
    await b.forge.mergePullRequest('o/r', pr.number, { method: 'squash' });
  });
});

describe('fake: reopen', () => {
  it('reopens a closed ticket, drops the close-reason label, and is idempotent', async () => {
    const b = new FakeBackend({ native: false });
    const ts = b.tickets('o/r');
    const t = await ts.create({ title: 't' });
    await ts.close(t.id, 'completed');
    await ts.reopen(t.id);
    await ts.reopen(t.id);
    const got = await ts.get(t.id);
    assert.equal(got.state, 'open');
    assert.ok(!got.labels.some((l) => l.startsWith('bauherr:close-reason:')));
  });
});

describe('fake: merge queue', () => {
  const setup = async (n: number) => {
    const b = new FakeBackend();
    b.setQueueSupport('o/r', true);
    const prs = [];
    for (let i = 1; i <= n; i++) {
      await b.forge.createBranch('o/r', `f${i}`);
      b.commit('o/r', `f${i}`, `${i}.txt`, 'x');
      prs.push(await b.forge.openPullRequest('o/r', { title: `t${i}`, head: `f${i}`, base: 'main' }));
    }
    return { b, prs };
  };
  it('advanceQueue merges the head entry with a merge sha, in order', async () => {
    const { b, prs } = await setup(2);
    for (const p of prs) await b.forge.enqueuePullRequest('o/r', p.number, { expectSha: p.headSha });
    assert.equal(b.advanceQueue('o/r'), 1);
    const first = await b.forge.getPullRequest('o/r', 1);
    assert.deepEqual([first.state, first.mergeSha], ['merged', 'merge' + first.mergeSha!.slice(5)]);
    assert.equal(await b.forge.isQueued('o/r', 2), true);
    assert.equal(b.advanceQueue('o/r'), 2);
    assert.equal(b.advanceQueue('o/r'), null);
  });
  it('a failed entry drops out and stays open', async () => {
    const { b, prs } = await setup(1);
    await b.forge.enqueuePullRequest('o/r', 1, { expectSha: prs[0]!.headSha });
    b.advanceQueue('o/r', { fail: [1] });
    assert.deepEqual([(await b.forge.getPullRequest('o/r', 1)).state, await b.forge.isQueued('o/r', 1)], ['open', false]);
  });
  it('enqueuing an already merged PR reports merged with its sha', async () => {
    const { b } = await setup(1);
    const sha = b.merge('o/r', 1);
    assert.deepEqual(await b.forge.enqueuePullRequest('o/r', 1, { expectSha: 'x' }), { state: 'merged', mergeSha: sha });
  });
});

describe('fake: train branch', () => {
  it('resetBranch sets a branch to a commit; mergeIntoBranch merges heads, reports a contained head and conflicts', async () => {
    const b = new FakeBackend();
    const main = (await b.forge.getBranch('o/r', 'main'))!.sha;
    const heads: string[] = [];
    for (const [i, file, content] of [[1, 'a.txt', 'x'], [2, 'b.txt', 'y'], [3, 'a.txt', 'z']] as const) {
      await b.forge.createBranch('o/r', `f${i}`);
      heads.push(b.commit('o/r', `f${i}`, file, content));
    }
    await b.forge.resetBranch('o/r', 'train', main);
    assert.equal((await b.forge.getBranch('o/r', 'train'))!.sha, main);
    const m1 = await b.forge.mergeIntoBranch('o/r', 'train', heads[0]!);
    assert.ok('sha' in m1 && m1.sha !== main);
    assert.deepEqual(await b.forge.mergeIntoBranch('o/r', 'train', heads[0]!), m1);
    assert.ok('sha' in (await b.forge.mergeIntoBranch('o/r', 'train', heads[1]!)));
    assert.deepEqual(await b.forge.mergeIntoBranch('o/r', 'train', heads[2]!), { conflict: true });
    await b.forge.resetBranch('o/r', 'train', main);
    assert.deepEqual((await b.forge.listFiles('o/r', 'train')).paths, []);
  });
});
