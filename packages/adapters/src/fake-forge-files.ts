import type { Forge, RepoRef } from './contracts.js';
import { Conflict } from './contracts.js';
import { blobSha } from './fake-state.js';
import type { FakeKit } from './fake-forge-kit.js';

const ISSUE_FORM = /^\.(github\/ISSUE_TEMPLATE\/(?!config\.ya?ml$)[^/]+\.ya?ml|gitlab\/issue_templates\/[^/]+\.md)$/;

export const fakeFileOps = (
  kit: FakeKit,
): Pick<Forge, 'listFiles' | 'getFile' | 'putFile' | 'compare' | 'fileExists' | 'countIssueForms'> => ({
  listFiles: async (repo: RepoRef, ref?: string) => {
    const r = kit.repoOf(repo);
    const b = r.branches.get(ref ?? r.defaultBranch);
    if (!b) throw new Error(`no branch ${ref}`);
    return { commit: b.sha, paths: [...b.files.keys()] };
  },
  getFile: async (repo: RepoRef, path: string, ref?: string) => {
    const r = kit.repoOf(repo);
    const content = (
      r.branches.get(ref ?? r.defaultBranch) ?? [...r.branches.values()].find((b) => b.sha === ref)
    )?.files.get(path);
    if (content === undefined) throw new Error(`no file ${path}`);
    return { content, sha: blobSha(content) };
  },
  putFile: async (
    repo: RepoRef,
    o: { branch: string; path: string; content: string; message: string; expectSha?: string },
  ) => {
    const b = kit.repoOf(repo).branches.get(o.branch);
    if (!b) throw new Error(`no branch ${o.branch}`);
    const old = b.files.get(o.path);
    if (o.expectSha !== undefined && (old === undefined ? '' : blobSha(old)) !== o.expectSha)
      throw new Conflict(`${o.path} changed`);
    kit.b.commit(repo, o.branch, o.path, o.content);
    return { sha: blobSha(o.content) };
  },
  compare: async (repo: RepoRef, base: string, head: string) => {
    const r = kit.repoOf(repo);
    const files = (ref: string) =>
      (r.branches.get(ref) ?? [...r.branches.values()].find((b) => b.sha === ref))?.files ?? new Map<string, string>();
    const [a, b] = [files(base), files(head)];
    return [...b]
      .filter(([name, content]) => a.get(name) !== content)
      .map(
        ([name, content]) =>
          `--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${content.split('\n').length} @@\n${content
            .split('\n')
            .map((l) => `+${l}`)
            .join('\n')}`,
      )
      .join('\n');
  },
  fileExists: async (repo: RepoRef, path: string, ref: string) => {
    return kit.repoOf(repo).branches.get(ref)?.files.has(path) ?? false;
  },
  countIssueForms: async (repo: RepoRef, ref: string) => {
    return [...(kit.repoOf(repo).branches.get(ref)?.files.keys() ?? [])].filter((p) => ISSUE_FORM.test(p)).length;
  },
});
