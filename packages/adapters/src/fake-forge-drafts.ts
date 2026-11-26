import type { Forge, RepoRef } from './contracts.js';
import type { FakeKit } from './fake-forge-kit.js';

export const fakeDraftOps = (kit: FakeKit): Pick<Forge, 'draftRelease' | 'publishRelease' | 'startDeploy'> => ({
  draftRelease: async (repo: RepoRef, o: { tag: string; sha: string; name: string; body: string }) => {
    const r = kit.repoOf(repo);
    const known = r.releases.find((x) => x.tag === o.tag);
    if (known) return { ...known };
    r.tags = r.tags.filter((t) => t !== o.tag);
    return kit.b.addRelease(repo, { tag: o.tag, sha: o.sha, body: o.body, draft: true });
  },
  publishRelease: async (repo: RepoRef, id: string, o: { body: string }) => {
    const rel = kit.repoOf(repo).releases.find((r) => r.id === id);
    if (!rel) throw new Error(`no release ${id}`);
    delete rel.draft;
    rel.body = o.body;
    return { ...rel };
  },
  startDeploy: async (repo: RepoRef, o: { workflow: string; ref: string; inputs: Record<string, string> }) => {
    kit.repoOf(repo).deployStarts.push(o);
  },
});
