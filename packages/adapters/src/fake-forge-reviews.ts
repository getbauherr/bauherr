import type { Check, Forge, InlineComment, RepoRef } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakeReviewOps = (
  kit: FakeKit,
): Pick<Forge, 'reviewPullRequest' | 'listReviewThreads' | 'resolveReviewThread' | 'listChecks' | 'rerunFailed'> => ({
  reviewPullRequest: async (repo: RepoRef, n: number, review: { body: string; comments: InlineComment[] }) => {
    kit.repoOf(repo).reviews.push({ number: n, ...review });
    return kit.post(repo, n, review.body);
  },
  listReviewThreads: async (repo: RepoRef, n: number) => {
    kit.find(repo, n);
    const r = kit.repoOf(repo);
    return r.reviews.flatMap((x, i) =>
      x.number === n
        ? x.comments.map((c, j) => ({
            id: `${i}.${j}`,
            body: c.body,
            resolved: r.resolvedThreads.has(`${i}.${j}`),
          }))
        : [],
    );
  },
  resolveReviewThread: async (repo: RepoRef, n: number, threadId: string) => {
    kit.find(repo, n);
    kit.repoOf(repo).resolvedThreads.add(threadId);
  },
  listChecks: async (repo: RepoRef, sha: string) => {
    return kit.repoOf(repo).checks.get(sha) ?? [];
  },
  rerunFailed: async (repo: RepoRef, checks: Check[]) => {
    const r = kit.repoOf(repo);
    r.reruns.push(checks);
    for (const [sha, next] of r.rerunChecks) r.checks.set(sha, next);
    r.rerunChecks.clear();
    return checks.length > 0 && checks.every((c) => c.runId);
  },
});
