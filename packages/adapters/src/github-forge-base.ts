import type { Branch, RepoRef } from './contracts.js';
import { Conflict } from './contracts.js';
import type { GithubApi } from './github-api.js';
import type { GithubAuth } from './github-auth.js';
import { GithubError } from './github-error.js';
import { githubRepository } from './github-mappers.js';
import { field, get, list, text, wire } from './wire.js';

const RULES_NOT_IN_PLAN = /Upgrade to GitHub/;

const enc = encodeURIComponent;
export const encodePath = (path: string): string => path.split('/').map(enc).join('/');

const ignoredRefStatuses = [404, 422];

/** Repositories, branches, files and git data: the part of the GitHub forge the other parts build on. */
export class GithubForgeBase {
  constructor(
    protected h: GithubApi,
    protected auth: GithubAuth,
  ) {}

  protected async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const r = wire(await this.h.json('POST', '/graphql', { query, variables }));
    const errors = list(r.errors);
    if (errors.length) throw new Error(`GitHub GraphQL: ${errors.map((e) => field(e, 'message')).join('; ')}`);
    return r.data;
  }

  async listRepositories() {
    const repos =
      this.auth.kind === 'app'
        ? await this.h.paginate('/installation/repositories?per_page=100', (p) => list(wire(p).repositories))
        : await this.h.paginate('/user/repos?per_page=100');
    return repos.map(githubRepository);
  }
  async getRepository(repo: RepoRef) {
    return githubRepository(await this.h.json('GET', `/repos/${repo}`));
  }
  async listBranches(repo: RepoRef): Promise<Branch[]> {
    return (await this.h.paginate(`/repos/${repo}/branches?per_page=100`)).map((b) => ({
      name: field(b, 'name'),
      sha: field(get(b, 'commit'), 'sha'),
    }));
  }
  async getBranch(repo: RepoRef, name: string): Promise<Branch | null> {
    try {
      const b = await this.h.json('GET', `/repos/${repo}/branches/${encodePath(name)}`);
      return { name, sha: field(get(b, 'commit'), 'sha') };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }
  async createBranch(repo: RepoRef, name: string, from?: string): Promise<Branch> {
    const base = from ?? (await this.getRepository(repo)).defaultBranch;
    const ref = await this.h.json('GET', `/repos/${repo}/git/ref/heads/${base}`);
    const sha = field(get(ref, 'object'), 'sha');
    await this.h.json('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${name}`, sha });
    return { name, sha };
  }
  async resetBranch(repo: RepoRef, branch: string, sha: string) {
    try {
      await this.h.json('PATCH', `/repos/${repo}/git/refs/heads/${encodePath(branch)}`, { sha, force: true });
    } catch (e) {
      if (!(e instanceof GithubError && ignoredRefStatuses.includes(e.status))) throw e;
      await this.h.json('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    }
  }
  async deleteBranch(repo: RepoRef, branch: string) {
    await this.h.json('DELETE', `/repos/${repo}/git/refs/heads/${encodePath(branch)}`).catch((e) => {
      if (!(e instanceof GithubError && ignoredRefStatuses.includes(e.status))) throw e;
    });
  }
  async mergeIntoBranch(repo: RepoRef, branch: string, headSha: string) {
    try {
      const m = await this.h.json('POST', `/repos/${repo}/merges`, {
        base: branch,
        head: headSha,
        commit_message: `bauherr train: merge ${headSha.slice(0, 7)}`,
      });
      if (m) return { sha: field(m, 'sha') };
      const ref = await this.h.json('GET', `/repos/${repo}/git/ref/heads/${encodePath(branch)}`);
      return { sha: field(get(ref, 'object'), 'sha') };
    } catch (e) {
      if (e instanceof GithubError && e.status === 409) return { conflict: true as const };
      throw e;
    }
  }
  async isBranchProtected(repo: RepoRef, branch: string) {
    const b = await this.h.json('GET', `/repos/${repo}/branches/${encodePath(branch)}`);
    return wire(b).protected === true;
  }
  async requiredChecks(repo: RepoRef, branch: string) {
    let rules: unknown;
    try {
      rules = await this.h.json('GET', `/repos/${repo}/rules/branches/${encodePath(branch)}`);
    } catch (e) {
      if (e instanceof GithubError && e.status === 403 && RULES_NOT_IN_PLAN.test(e.message)) return [];
      throw e;
    }
    return list(rules)
      .filter((r) => wire(r).type === 'required_status_checks')
      .flatMap((r) => list(get(r, 'parameters', 'required_status_checks')).map((c) => field(c, 'context')));
  }
  async fileExists(repo: RepoRef, path: string, ref: string) {
    const url = `/repos/${repo}/contents/${encodePath(path)}?ref=${enc(ref)}`;
    try {
      await this.h.raw('GET', url);
      return true;
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return false;
      throw e;
    }
  }
  async countIssueForms(repo: RepoRef, ref: string) {
    let entries: unknown;
    try {
      entries = await this.h.json('GET', `/repos/${repo}/contents/.github/ISSUE_TEMPLATE?ref=${enc(ref)}`);
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return 0;
      throw e;
    }
    const form = /^(?!config\.ya?ml$).+\.ya?ml$/;
    return list(entries).filter((f) => field(f, 'type') === 'file' && form.test(field(f, 'name'))).length;
  }
  async listFiles(repo: RepoRef, ref?: string) {
    const c = await this.h.json(
      'GET',
      `/repos/${repo}/commits/${enc(ref ?? (await this.getRepository(repo)).defaultBranch)}`,
    );
    const treeSha = field(get(c, 'commit', 'tree'), 'sha');
    const tree = wire(await this.h.json('GET', `/repos/${repo}/git/trees/${treeSha}?recursive=1`));
    return {
      commit: field(c, 'sha'),
      paths: list(tree.tree)
        .filter((t) => wire(t).type === 'blob')
        .map((t) => field(t, 'path')),
      truncated: tree.truncated === true,
    };
  }
  async getFile(repo: RepoRef, path: string, ref?: string) {
    const f = wire(
      await this.h.json('GET', `/repos/${repo}/contents/${encodePath(path)}${ref ? `?ref=${enc(ref)}` : ''}`),
    );
    const data =
      f.encoding === 'base64'
        ? text(f.content)
        : field(await this.h.json('GET', `/repos/${repo}/git/blobs/${text(f.sha)}`), 'content');
    return { content: Buffer.from(data, 'base64').toString('utf8'), sha: text(f.sha) };
  }
  async putFile(
    repo: RepoRef,
    o: { branch: string; path: string; content: string; message: string; expectSha?: string },
  ) {
    const url = `/repos/${repo}/contents/${encodePath(o.path)}`;
    if (o.expectSha === '') {
      const exists = await this.h.raw('GET', `${url}?ref=${enc(o.branch)}`).then(
        () => true,
        (e: unknown) => {
          if (e instanceof GithubError && e.status === 404) return false;
          throw e;
        },
      );
      if (exists) throw new Conflict(`${o.path} exists`);
    }
    try {
      const r = await this.h.json('PUT', url, {
        message: o.message,
        content: Buffer.from(o.content).toString('base64'),
        branch: o.branch,
        ...(o.expectSha ? { sha: o.expectSha } : {}),
      });
      return { sha: field(get(r, 'content'), 'sha') };
    } catch (e) {
      if (e instanceof GithubError && (e.status === 409 || e.status === 422)) throw new Conflict(e.message);
      throw e;
    }
  }
  async getCommitDate(repo: RepoRef, sha: string) {
    return field(get(await this.h.json('GET', `/repos/${repo}/commits/${sha}`), 'commit', 'committer'), 'date');
  }
  async compare(repo: RepoRef, base: string, head: string) {
    return (
      await this.h.raw(
        'GET',
        `/repos/${repo}/compare/${enc(base)}...${enc(head)}`,
        undefined,
        'application/vnd.github.diff',
      )
    ).text();
  }
  async isAncestor(repo: RepoRef, base: string, head: string) {
    const compared = await this.h.json('GET', `/repos/${repo}/compare/${enc(base)}...${enc(head)}?per_page=1`);
    return ['ahead', 'identical'].includes(field(compared, 'status'));
  }
}
