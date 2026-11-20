import type { Forge, NewPullRequest, PullRequest, RepoRef } from './contracts.js';
import { closingIssues } from './closing-issues.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakePullOps = (
  kit: FakeKit,
): Pick<
  Forge,
  'openPullRequest' | 'getPullRequest' | 'closePullRequest' | 'commentOnPullRequest' | 'retargetPullRequest'
> => ({
  openPullRequest: async (repo: RepoRef, pr: NewPullRequest) => {
    const r = kit.repoOf(repo);
    const number = kit.b.nextNumber(repo);
    const created: PullRequest = {
      number,
      url: `https://github.com/${repo}/pull/${number}`,
      title: pr.title,
      body: pr.body ?? '',
      state: 'open',
      head: pr.head,
      base: pr.base,
      headSha: kit.sha(r, pr.head),
      headRepo: repo,
      baseRepo: repo,
      draft: false,
      author: kit.b.actingAs,
      authorTrusted: kit.b.isTrusted(kit.b.actingAs),
      authorIsBot: kit.b.isBot(kit.b.actingAs),
      createdAt: kit.b.now(),
      updatedAt: '',
      labels: [],
      assignees: [],
      closes: closingIssues(pr.body ?? ''),
    };
    created.updatedAt = created.createdAt;
    r.prs.push(created);
    return created;
  },
  getPullRequest: async (repo: RepoRef, n: number) => {
    return kit.find(repo, n);
  },
  closePullRequest: async (repo: RepoRef, n: number) => {
    const pr = kit.find(repo, n);
    if (pr.state === 'open') kit.b.close(repo, n);
  },
  commentOnPullRequest: async (repo: RepoRef, n: number, body: string) => {
    return kit.post(repo, n, body);
  },
  retargetPullRequest: async (repo: RepoRef, n: number, base: string) => {
    const pr = kit.find(repo, n);
    if (pr.state !== 'open') throw new Error(`PR ${n} is ${pr.state}`);
    pr.base = base;
  },
});
