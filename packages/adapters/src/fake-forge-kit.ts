import type { Comment, PullRequest, RepoRef, Repository } from './contracts.js';
import type { FakeBackend } from './fake.js';
import type { FakeAccess, FakeRepo } from './fake-state.js';

export interface FakeKit {
  b: FakeBackend;
  access: FakeAccess;
  repoOf(name: RepoRef): FakeRepo;
  sha(r: FakeRepo, branch: string): string;
  find(repo: RepoRef, n: number): PullRequest;
  post(repo: RepoRef, n: number, body: string): Comment;
  commentsOf(repo: RepoRef, n: number): Comment[];
  view(repo: RepoRef, name: string): Repository;
}

export const makeFakeKit = (b: FakeBackend, access: FakeAccess): FakeKit => {
  const comments = new Map<string, Comment[]>();
  const kit: FakeKit = {
    b,
    access,
    repoOf: (name) => access.repo(name),
    sha: (r, branch) => r.branches.get(branch)?.sha ?? '',
    find: (repo, n) => {
      const pr = access.repo(repo).prs.find((p) => p.number === n);
      if (!pr) throw new Error(`no PR ${n}`);
      if (pr.state === 'open') pr.headSha = kit.sha(access.repo(repo), pr.head) || pr.headSha;
      return pr;
    },
    post: (repo, n, body) => {
      kit.find(repo, n);
      const at = b.now();
      const c: Comment = { id: String(access.nextSeq()), author: b.actingAs, body, createdAt: at, updatedAt: at };
      comments.set(`${repo}#${n}`, [...(comments.get(`${repo}#${n}`) ?? []), c]);
      return c;
    },
    commentsOf: (repo, n) => comments.get(`${repo}#${n}`) ?? [],
    view: (repo, name) => ({
      fullName: name,
      defaultBranch: access.repo(repo).defaultBranch,
      private: true,
      url: `https://fake/${name}`,
    }),
  };
  return kit;
};
