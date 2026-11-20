import type { Branch, Forge, RepoRef } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakeBranchOps = (
  kit: FakeKit,
): Pick<
  Forge,
  'listRepositories' | 'getRepository' | 'listBranches' | 'getBranch' | 'createBranch' | 'resetBranch' | 'deleteBranch'
> => ({
  listRepositories: async () => {
    return kit.access.repoNames().map((n) => kit.view(n, n));
  },
  getRepository: async (repo: RepoRef) => {
    return kit.view(repo, repo);
  },
  listBranches: async (repo: RepoRef) => {
    return [...kit.repoOf(repo).branches].map(([name, b]): Branch => ({ name, sha: b.sha }));
  },
  getBranch: async (repo: RepoRef, name: string) => {
    const b = kit.repoOf(repo).branches.get(name);
    return b ? { name, sha: b.sha } : null;
  },
  createBranch: async (repo: RepoRef, name: string, from?: string) => {
    const r = kit.repoOf(repo);
    const src = r.branches.get(from ?? r.defaultBranch);
    if (!src) throw new Error(`no branch ${from}`);
    if (r.branches.has(name)) throw new Error(`branch exists ${name}`);
    r.branches.set(name, { sha: src.sha, files: new Map(src.files) });
    return { name, sha: src.sha };
  },
  resetBranch: async (repo: RepoRef, branch: string, at: string) => {
    const r = kit.repoOf(repo);
    const files = r.snapshots.get(at);
    if (!files) throw new Error(`no commit ${at}`);
    r.branches.set(branch, { sha: at, files: new Map(files) });
  },
  deleteBranch: async (repo: RepoRef, branch: string) => {
    kit.repoOf(repo).branches.delete(branch);
  },
});
