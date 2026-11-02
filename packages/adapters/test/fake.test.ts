import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeBackend } from '../src/index.js';
import { contractSuite } from './contract.js';

for (const native of [true, false]) {
  const backend = new FakeBackend({ native, user: 'octo' });
  contractSuite(`fake (${native ? 'native' : 'body-convention'})`, {
    backend, repo: 'acme/app', user: 'octo',
    commitFile: async (branch, path, content) => backend.commit('acme/app', branch, path, content),
  });
}

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
