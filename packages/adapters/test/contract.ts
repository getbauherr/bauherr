import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { APPROVED_PLAN, closeReasonLabel, setStage, stageLabel, stageOf, type Backend, type CloseReason } from '../src/index.js';

export interface ContractEnv {
  backend: Backend;
  repo: string;
  user: string;
  /** Writes a file on a branch (needed so a PR has a diff). */
  commitFile(branch: string, path: string, content: string): Promise<void>;
  /** Runs after the suite with the created ticket ids, branches and PR numbers. */
  cleanup?(created: { tickets: string[]; branches: string[]; prs: number[]; labels: string[] }): Promise<void>;
}

/** GitHub's list endpoints are eventually consistent (seconds): retry assertions. */
async function eventually(fn: () => Promise<void>, tries = 10): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export function contractSuite(name: string, env: ContractEnv): void {
  const { backend, repo, user } = env;
  const ts = backend.tickets(repo);
  const made = { tickets: [] as string[], branches: [] as string[], prs: [] as number[], labels: [] as string[] };
  const mk = async (title: string, extra: { body?: string; labels?: string[] } = {}) => {
    const t = await ts.create({ title: `contract: ${title}`, ...extra });
    made.tickets.push(t.id);
    return t;
  };
  after(async () => env.cleanup?.(made));

  describe(`${name}: TicketSource`, () => {
    it('declares capabilities', () => {
      for (const k of ['attachments', 'nativeSubTickets', 'nativeBlocking', 'webhooks'] as const) assert.equal(typeof backend.capabilities[k], 'boolean');
    });

    it('create + get round-trips', async () => {
      const t = await mk('create', { body: 'hello', labels: ['bauherr:test'] });
      const g = await ts.get(t.id);
      assert.equal(g.title, 'contract: create');
      assert.equal(g.body, 'hello');
      assert.equal(g.state, 'open');
      assert.deepEqual(g.labels, ['bauherr:test']);
      assert.equal(g.assignee, null);
      assert.equal(g.parent, null);
      assert.deepEqual([g.blockedBy, g.links], [[], []]);
      assert.equal(g.number, Number(g.id));
      assert.match(g.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    });

    it('list filters by state and labels', async () => {
      const label = `bauherr:list-${Date.now()}`;
      made.labels.push(label);
      const a = await mk('list-a', { labels: [label] });
      const b = await mk('list-b', { labels: [label] });
      await ts.close(b.id, 'completed');
      const ids = async (o: Parameters<typeof ts.list>[0]) => (await ts.list(o)).map((s) => s.id);
      await eventually(async () => {
        assert.deepEqual(await ids({ labels: [label] }), [a.id]);
        assert.deepEqual((await ids({ labels: [label], state: 'all' })).sort(), [a.id, b.id].sort());
        assert.deepEqual(await ids({ labels: [label], state: 'closed' }), [b.id]);
      });
    });

    it('comments and lists them', async () => {
      const t = await mk('comment');
      const c = await ts.comment(t.id, 'first');
      assert.equal(c.body, 'first');
      assert.deepEqual((await ts.listComments(t.id)).map((x) => x.body), ['first']);
    });

    it('adds and removes labels, tolerating absent ones', async () => {
      const t = await mk('labels');
      await ts.addLabels(t.id, ['bauherr:a', 'bauherr:b']);
      await ts.removeLabels(t.id, ['bauherr:a', 'bauherr:never-there']);
      assert.deepEqual((await ts.get(t.id)).labels, ['bauherr:b']);
    });

    it('setStage keeps exactly one stage label', async () => {
      const t = await mk('stage', { labels: ['keep'] });
      await setStage(ts, t.id, 'plan');
      await ts.addLabels(t.id, [APPROVED_PLAN]);
      await setStage(ts, t.id, 'build');
      const { labels } = await ts.get(t.id);
      assert.deepEqual(labels.filter((l) => l.startsWith('bauherr:stage:')), [stageLabel('build')]);
      assert.equal(stageOf(labels), 'build');
      assert.ok(labels.includes('keep') && labels.includes(APPROVED_PLAN));
    });

    it('claims and releases', async () => {
      const t = await mk('claim');
      await ts.claim(t.id, user);
      assert.equal((await ts.get(t.id)).assignee?.toLowerCase(), user.toLowerCase());
      await ts.release(t.id);
      assert.equal((await ts.get(t.id)).assignee, null);
    });

    it('claim of an unknown login throws', async () => {
      const t = await mk('claim-bad');
      await assert.rejects(ts.claim(t.id, 'nonexistent-user-zzz9-bauherr'));
    });

    for (const reason of ['completed', 'not_planned', 'duplicate'] as CloseReason[]) {
      it(`closes with reason ${reason}`, async () => {
        const t = await mk(`close-${reason}`);
        await ts.close(t.id, reason);
        const g = await ts.get(t.id);
        assert.equal(g.state, 'closed');
        assert.equal(g.closeReason, reason);
        assert.equal(g.labels.includes(closeReasonLabel(reason)), !backend.capabilities.nativeSubTickets);
      });
    }

    it('links sub-tickets and lists them', async () => {
      const p = await mk('parent');
      const c = await mk('child');
      await ts.addSubTicket(p.id, c.id);
      assert.deepEqual((await ts.listSubTickets(p.id)).map((s) => s.id), [c.id]);
      assert.equal((await ts.get(c.id)).parent, p.id);
      assert.equal((await ts.get(p.id)).parent, null);
      await assert.rejects(ts.addSubTicket((await mk('other-parent')).id, c.id));
    });

    it('frontier excludes blocked and closed sub-tickets', async () => {
      const p = await mk('f-parent');
      const a = await mk('f-a');
      const b = await mk('f-b');
      const c = await mk('f-c');
      for (const x of [a, b, c]) await ts.addSubTicket(p.id, x.id);
      await ts.addBlockedBy(b.id, a.id);
      assert.deepEqual((await ts.get(b.id)).blockedBy, [a.id]);
      assert.deepEqual((await ts.frontier(p.id)).map((s) => s.id).sort(), [a.id, c.id].sort());
      await ts.close(a.id, 'completed');
      await ts.close(c.id, 'not_planned');
      assert.deepEqual((await ts.frontier(p.id)).map((s) => s.id), [b.id]);
    });

    it('adds links without leaking the relations block into body', async () => {
      const t = await mk('link', { body: 'text' });
      await ts.addLink(t.id, 'https://example.com/a');
      await ts.addLink(t.id, 'https://example.com/b');
      const g = await ts.get(t.id);
      assert.equal(g.body, 'text');
      assert.deepEqual(g.links, ['https://example.com/a', 'https://example.com/b']);
    });

    it('polls: null cursor sees everything, cursor sees only newer, at-least-once', async () => {
      const all = await ts.poll(null);
      assert.ok(all.changes.length >= made.tickets.length);
      assert.equal(all.next, all.changes.at(-1)?.updatedAt);
      const t = await mk('poll');
      await eventually(async () => {
        const again = await ts.poll(all.next);
        assert.ok(again.changes.some((s) => s.id === t.id));
        assert.ok(again.changes.length < all.changes.length + 1);
        assert.ok(again.changes.every((s) => s.updatedAt >= all.next!));
        assert.ok(again.next! >= all.next!);
      });
    });
  });

  describe(`${name}: Forge`, () => {
    it('reads repositories', async () => {
      const r = await backend.forge.getRepository(repo);
      assert.equal(r.fullName.toLowerCase(), repo.toLowerCase());
      assert.ok(r.defaultBranch);
      assert.ok((await backend.forge.listRepositories()).some((x) => x.fullName.toLowerCase() === repo.toLowerCase()));
    });

    it('branch -> PR -> comment -> files -> checks', async () => {
      const f = backend.forge;
      const branch = `bauherr-contract-${Date.now()}`;
      const b = await f.createBranch(repo, branch);
      made.branches.push(branch);
      assert.ok((await f.listBranches(repo)).some((x) => x.name === branch && x.sha === b.sha));
      await env.commitFile(branch, 'contract/hello.txt', 'hello\n');
      const base = (await f.getRepository(repo)).defaultBranch;
      const p = await f.openPullRequest(repo, { title: 'contract PR', body: 'b', head: branch, base });
      made.prs.push(p.number);
      assert.equal(p.state, 'open');
      assert.equal((await f.getPullRequest(repo, p.number)).head, branch);
      assert.ok((await f.listPullRequests(repo)).some((x) => x.number === p.number));
      assert.equal((await f.commentOnPullRequest(repo, p.number, 'lgtm')).body, 'lgtm');
      const files = await f.listPullRequestFiles(repo, p.number);
      assert.deepEqual(files.map((x) => x.filename), ['contract/hello.txt']);
      assert.equal(files[0]?.status, 'added');
      assert.ok(Array.isArray(await f.listChecks(repo, (await f.getPullRequest(repo, p.number)).headSha)));
    });
  });
}
