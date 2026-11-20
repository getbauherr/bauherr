import type { Forge, RepoRef } from './contracts.js';
import { NotQueueableError } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakeMergeOps = (
  kit: FakeKit,
): Pick<Forge, 'mergePullRequest' | 'enqueuePullRequest' | 'dequeuePullRequest' | 'isQueued'> => ({
  mergePullRequest: async (
    repo: RepoRef,
    n: number,
    o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string },
  ) => {
    const pr = kit.find(repo, n);
    if (pr.state !== 'open') throw new Error(`PR ${n} is ${pr.state}`);
    if (pr.mergeable === false) throw new Error('merge commit cannot be cleanly created');
    if (o.expectSha && o.expectSha !== kit.sha(kit.repoOf(repo), pr.head)) throw new Error(`PR ${n} head moved`);
    const mergeSha = kit.b.merge(repo, n);
    if (o.deleteBranch && pr.headRepo === pr.baseRepo) {
      for (const s of kit.repoOf(repo).prs) if (s.state === 'open' && s.base === pr.head) s.base = pr.base;
      kit.repoOf(repo).branches.delete(pr.head);
    }
    return { mergeSha };
  },
  enqueuePullRequest: async (
    repo: RepoRef,
    n: number,
    o: { expectSha: string },
  ): Promise<{ state: 'queued' | 'merged'; mergeSha?: string }> => {
    const r = kit.repoOf(repo);
    const pr = kit.find(repo, n);
    if (pr.state === 'merged') return { state: 'merged', mergeSha: pr.mergeSha };
    if (pr.state !== 'open') throw new Error(`PR ${n} is ${pr.state}`);
    if (!r.queueSupport) throw new NotQueueableError('the base branch has no merge queue');
    if (pr.mergeable === false) throw new NotQueueableError('the pull request is not mergeable');
    if (o.expectSha !== kit.sha(r, pr.head)) throw new Error(`PR ${n} head moved`);
    if (!r.queue.includes(n)) r.queue.push(n);
    return { state: 'queued' };
  },
  dequeuePullRequest: async (repo: RepoRef, n: number) => {
    const r = kit.repoOf(repo);
    r.queue = r.queue.filter((x) => x !== n);
  },
  isQueued: async (repo: RepoRef, n: number) => {
    return kit.repoOf(repo).queue.includes(n) && kit.find(repo, n).state === 'open';
  },
});
