import type { Forge, RepoRef } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakeReleaseOps = (
  kit: FakeKit,
): Pick<
  Forge,
  | 'findRelease'
  | 'createRelease'
  | 'listReleases'
  | 'releaseByTag'
  | 'updateRelease'
  | 'latestRelease'
  | 'tagSha'
  | 'listTags'
  | 'listCommits'
> => ({
  findRelease: async (repo: RepoRef, o: { sha: string }) => {
    return (
      kit.repoOf(repo).releases.find((r) => r.sha === o.sha || kit.repoOf(repo).contains.get(r.tag)?.includes(o.sha)) ??
      null
    );
  },
  createRelease: async (
    repo: RepoRef,
    o: { tag: string; sha: string; name: string; body: string; prerelease?: boolean },
  ) => {
    const r = kit.repoOf(repo);
    if (r.releases.some((x) => x.tag === o.tag)) throw new Error(`tag exists ${o.tag}`);
    const sha = r.tagShas.get(o.tag) ?? o.sha;
    r.tags = r.tags.filter((t) => t !== o.tag);
    return kit.b.addRelease(repo, { ...o, sha, createdAt: r.commitDates.get(sha) });
  },
  listReleases: async (repo: RepoRef) => {
    return [...kit.repoOf(repo).releases].reverse();
  },
  releaseByTag: async (repo: RepoRef, tag: string) => {
    return kit.repoOf(repo).releases.find((r) => r.tag === tag) ?? null;
  },
  updateRelease: async (repo: RepoRef, id: string, o: { body: string }) => {
    const rel = kit.repoOf(repo).releases.find((r) => r.id === id);
    if (!rel) throw new Error(`no release ${id}`);
    rel.body = o.body;
    return { ...rel };
  },
  latestRelease: async (repo: RepoRef) => {
    return (
      kit
        .repoOf(repo)
        .releases.filter((r) => !r.prerelease)
        .at(-1) ?? null
    );
  },
  tagSha: async (repo: RepoRef, tag: string) => {
    return kit.repoOf(repo).releases.find((r) => r.tag === tag)?.sha ?? kit.repoOf(repo).tagShas.get(tag) ?? null;
  },
  listTags: async (repo: RepoRef) => {
    return [...kit.repoOf(repo).releases.map((r) => r.tag), ...kit.repoOf(repo).tags];
  },
  listCommits: async (repo: RepoRef) => {
    return kit.repoOf(repo).commits;
  },
});
