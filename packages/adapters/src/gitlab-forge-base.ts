import { IDEMPOTENT } from './retry.js';
import type { Branch, RepoRef } from './contracts.js';
import { Conflict } from './contracts.js';
import type { GitlabApi } from './gitlab-api.js';
import { GitlabError } from './gitlab.js';
import { gitlabRepository } from './gitlab-mappers.js';
import { field, get, list, text, wire } from './wire.js';

const enc = encodeURIComponent;

const ignoreMissing = (e: unknown): void => {
  if (!(e instanceof GitlabError && e.status === 404)) throw e;
};

/** Repositories, branches, files and git data: the part of the GitLab forge the other parts build on. */
export class GitlabForgeBase {
  constructor(protected h: GitlabApi) {}

  async listRepositories() {
    return (await this.h.paginate('/projects?membership=true&per_page=100')).map(gitlabRepository);
  }
  async getRepository(repo: RepoRef) {
    return gitlabRepository(await this.h.json('GET', `/projects/${enc(repo)}`));
  }
  async listBranches(repo: RepoRef): Promise<Branch[]> {
    return (await this.h.paginate(`/projects/${enc(repo)}/repository/branches?per_page=100`)).map((b) => ({
      name: field(b, 'name'),
      sha: field(get(b, 'commit'), 'id'),
    }));
  }
  async getBranch(repo: RepoRef, name: string): Promise<Branch | null> {
    try {
      const b = await this.h.json('GET', `/projects/${enc(repo)}/repository/branches/${enc(name)}`);
      return { name, sha: field(get(b, 'commit'), 'id') };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }
  async createBranch(repo: RepoRef, name: string, from?: string): Promise<Branch> {
    const ref = from ?? (await this.getRepository(repo)).defaultBranch;
    const b = await this.h.json(
      'POST',
      `/projects/${enc(repo)}/repository/branches?branch=${enc(name)}&ref=${enc(ref)}`,
    );
    return { name, sha: field(get(b, 'commit'), 'id') };
  }
  async resetBranch(repo: RepoRef, branch: string, sha: string) {
    const url = `/projects/${enc(repo)}/repository/branches/${enc(branch)}`;
    await this.h.json('DELETE', url, undefined, IDEMPOTENT).catch(ignoreMissing);
    await this.h.json('POST', `/projects/${enc(repo)}/repository/branches?branch=${enc(branch)}&ref=${enc(sha)}`);
  }
  async deleteBranch(repo: RepoRef, branch: string) {
    const url = `/projects/${enc(repo)}/repository/branches/${enc(branch)}`;
    await this.h.json('DELETE', url, undefined, IDEMPOTENT).catch(ignoreMissing);
  }
  async isBranchProtected(repo: RepoRef, branch: string) {
    try {
      await this.h.json('GET', `/projects/${enc(repo)}/protected_branches/${enc(branch)}`);
      return true;
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return false;
      if (e instanceof GitlabError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  }
  async requiredChecks() {
    return [];
  }
  async isAncestor(repo: RepoRef, base: string, head: string) {
    const baseSha = field(await this.h.json('GET', `/projects/${enc(repo)}/repository/commits/${enc(base)}`), 'id');
    const mergeBase = await this.h.json(
      'GET',
      `/projects/${enc(repo)}/repository/merge_base?refs[]=${enc(base)}&refs[]=${enc(head)}`,
    );
    return field(mergeBase, 'id') === baseSha;
  }
  async compare(repo: RepoRef, base: string, head: string) {
    const r = await this.h.json('GET', `/projects/${enc(repo)}/repository/compare?from=${enc(base)}&to=${enc(head)}`);
    return list(wire(r).diffs)
      .map((d) => `--- a/${field(d, 'old_path')}\n+++ b/${field(d, 'new_path')}\n${field(d, 'diff')}`)
      .join('\n');
  }
  async getCommitDate(repo: RepoRef, sha: string) {
    return field(await this.h.json('GET', `/projects/${enc(repo)}/repository/commits/${enc(sha)}`), 'committed_date');
  }
  protected file(repo: RepoRef, path: string, ref: string) {
    return this.h.json('GET', `/projects/${enc(repo)}/repository/files/${enc(path)}?ref=${enc(ref)}`);
  }
  async fileExists(repo: RepoRef, path: string, ref: string) {
    try {
      await this.file(repo, path, ref);
      return true;
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return false;
      throw e;
    }
  }
  async countIssueForms(repo: RepoRef, ref: string) {
    const dir = enc('.gitlab/issue_templates');
    let entries: unknown;
    try {
      entries = await this.h.json('GET', `/projects/${enc(repo)}/repository/tree?path=${dir}&ref=${enc(ref)}`);
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return 0;
      throw e;
    }
    return list(entries).filter((f) => field(f, 'type') === 'blob' && field(f, 'name').endsWith('.md')).length;
  }
  async listFiles(repo: RepoRef, ref?: string) {
    const c = await this.h.json(
      'GET',
      `/projects/${enc(repo)}/repository/commits/${enc(ref ?? (await this.getRepository(repo)).defaultBranch)}`,
    );
    const tree = await this.h.paginate(
      `/projects/${enc(repo)}/repository/tree?ref=${enc(field(c, 'id'))}&recursive=true&per_page=100`,
    );
    return {
      commit: field(c, 'id'),
      paths: tree.filter((t) => wire(t).type === 'blob').map((t) => field(t, 'path')),
    };
  }
  async getFile(repo: RepoRef, path: string, ref?: string) {
    const f = wire(await this.file(repo, path, ref ?? (await this.getRepository(repo)).defaultBranch));
    return { content: Buffer.from(text(f.content), 'base64').toString('utf8'), sha: text(f.blob_id) };
  }
  async putFile(
    repo: RepoRef,
    o: { branch: string; path: string; content: string; message: string; expectSha?: string },
  ) {
    const cur = await this.file(repo, o.path, o.branch).catch((e: unknown) => {
      if (e instanceof GitlabError && e.status === 404) return null;
      throw e;
    });
    if (o.expectSha !== undefined && (cur ? field(cur, 'blob_id') : '') !== o.expectSha) {
      throw new Conflict(`${o.path} changed`);
    }
    try {
      await this.h.json(cur ? 'PUT' : 'POST', `/projects/${enc(repo)}/repository/files/${enc(o.path)}`, {
        branch: o.branch,
        content: o.content,
        commit_message: o.message,
        ...(cur ? { last_commit_id: field(cur, 'last_commit_id') } : {}),
      });
    } catch (e) {
      if (e instanceof GitlabError && (e.status === 400 || e.status === 409)) throw new Conflict(e.message);
      throw e;
    }
    return { sha: field(await this.file(repo, o.path, o.branch), 'blob_id') };
  }
}
