import type { Forge, RepoRef } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakeFactOps = (
  kit: FakeKit,
): Pick<
  Forge,
  | 'isAncestor'
  | 'getCommitDate'
  | 'queueSupport'
  | 'requiredChecks'
  | 'isBranchProtected'
  | 'mergeIntoBranch'
  | 'latestDeployment'
  | 'commitEndpoint'
  | 'canWrite'
> => ({
  latestDeployment: async (repo: RepoRef, environment: string) => {
    return kit.repoOf(repo).deployments.get(environment) ?? null;
  },
  commitEndpoint: async (repo: RepoRef) => {
    return kit.repoOf(repo).commitEndpoint;
  },
  canWrite: async (repo: RepoRef) => {
    return kit.repoOf(repo).canWrite;
  },
  isAncestor: async (repo: RepoRef, base: string, head: string) => {
    return base === head || !!kit.repoOf(repo).ancestors.get(head)?.includes(base);
  },
  getCommitDate: async (repo: RepoRef, sha: string) => {
    return kit.repoOf(repo).commitDates.get(sha) ?? new Date(0).toISOString();
  },
  queueSupport: async (repo: RepoRef) => {
    return kit.repoOf(repo).queueSupport;
  },
  requiredChecks: async (repo: RepoRef) => {
    return kit.repoOf(repo).requiredChecks;
  },
  isBranchProtected: async (repo: RepoRef) => {
    return kit.repoOf(repo).branchProtected;
  },
  mergeIntoBranch: async (
    repo: RepoRef,
    branch: string,
    headSha: string,
  ): Promise<{ sha: string } | { conflict: true }> => {
    const r = kit.repoOf(repo);
    const target = r.branches.get(branch);
    const head = r.snapshots.get(headSha);
    if (!target || !head) throw new Error(`no branch ${branch} or commit ${headSha}`);
    if (
      r.prs.some((p) => p.headSha === headSha && p.mergeable === false) ||
      [...head].some(([path, c]) => target.files.has(path) && target.files.get(path) !== c)
    )
      return { conflict: true };
    if ([...head].every(([path, c]) => target.files.get(path) === c)) return { sha: target.sha };
    for (const [path, c] of head) target.files.set(path, c);
    target.sha = `sha${kit.access.nextSeq()}`;
    r.snapshots.set(target.sha, new Map(target.files));
    return { sha: target.sha };
  },
});
