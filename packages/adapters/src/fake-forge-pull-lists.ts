import type { Forge, PullRequestFile, RepoRef } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakePullListOps = (
  kit: FakeKit,
): Pick<
  Forge,
  | 'listPullRequests'
  | 'listOpenPullRequests'
  | 'listMergedPullRequests'
  | 'listPullRequestComments'
  | 'listPullRequestFiles'
> => ({
  listPullRequests: async (repo: RepoRef, state: 'open' | 'closed' | 'all' = 'open', head?: string) => {
    return kit
      .repoOf(repo)
      .prs.filter(
        (p) => (state === 'all' || (state === 'open') === (p.state === 'open')) && (!head || p.head === head),
      );
  },
  listOpenPullRequests: async (repo: RepoRef, page: number, perPage: number) => {
    return kit
      .repoOf(repo)
      .prs.filter((p) => p.state === 'open')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number)
      .slice((page - 1) * perPage, page * perPage);
  },
  listMergedPullRequests: async (repo: RepoRef, limit: number) => {
    return kit
      .repoOf(repo)
      .prs.filter((p) => p.state === 'merged')
      .slice(-limit)
      .reverse();
  },
  listPullRequestComments: async (repo: RepoRef, n: number) => {
    kit.find(repo, n);
    return kit.commentsOf(repo, n);
  },
  listPullRequestFiles: async (repo: RepoRef, n: number) => {
    const r = kit.repoOf(repo);
    const pr = kit.find(repo, n);
    const base = r.branches.get(pr.base)?.files ?? new Map<string, string>();
    const out: PullRequestFile[] = [];
    for (const [filename, content] of r.branches.get(pr.head)?.files ?? []) {
      const old = base.get(filename);
      if (old === content) continue;
      out.push({
        filename,
        status: old === undefined ? 'added' : 'modified',
        additions: content.split('\n').length,
        deletions: old === undefined ? 0 : old.split('\n').length,
      });
    }
    return out;
  },
});
