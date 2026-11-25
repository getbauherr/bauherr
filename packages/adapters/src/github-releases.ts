import type { Deployment, DeploymentState, Release, RepoRef } from './contracts.js';
import { GithubError } from './github-error.js';
import { GithubMergeQueue } from './github-merge-queue.js';
import { githubRelease } from './github-mappers.js';
import { probeCommit } from './release-probe.js';
import { field, get, idText, list, maybeText, nullableText, text, wire } from './wire.js';

const enc = encodeURIComponent;

const DEPLOYMENT_STATES: Record<string, DeploymentState> = { success: 'success', failure: 'failure', error: 'failure' };

const isPublished = (release: unknown): boolean => !wire(release).draft;

/** Releases, tags and commit ranges. */
export class GithubReleases extends GithubMergeQueue {
  protected async releaseOf(repo: RepoRef, r: unknown): Promise<Release | null> {
    try {
      const sha = field(await this.h.json('GET', `/repos/${repo}/commits/${enc(field(r, 'tag_name'))}`), 'sha');
      return githubRelease(r, sha);
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return null;
      throw e;
    }
  }
  async findRelease(repo: RepoRef, o: { sha: string }) {
    let found: Release | null = null;
    for (const r of list(await this.h.json('GET', `/repos/${repo}/releases?per_page=30`)).filter(isPublished)) {
      const rel = await this.releaseOf(repo, r);
      if (!rel) continue;
      if (rel.sha !== o.sha) {
        const compared = await this.h.json('GET', `/repos/${repo}/compare/${enc(o.sha)}...${enc(rel.sha)}?per_page=1`);
        if (field(compared, 'status') !== 'ahead') break;
      }
      found = rel;
    }
    return found;
  }
  async releaseByTag(repo: RepoRef, tag: string) {
    try {
      const r = await this.h.json('GET', `/repos/${repo}/releases/tags/${enc(tag)}`);
      return wire(r).draft ? null : this.releaseOf(repo, r);
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return null;
      throw e;
    }
  }
  async listReleases(repo: RepoRef) {
    const out: Release[] = [];
    for (const r of list(await this.h.json('GET', `/repos/${repo}/releases?per_page=30`)).filter(isPublished)) {
      const rel = await this.releaseOf(repo, r);
      if (rel) out.push(rel);
    }
    return out;
  }
  async createRelease(
    repo: RepoRef,
    o: { tag: string; sha: string; name: string; body: string; prerelease?: boolean },
  ) {
    const draft = list(await this.h.json('GET', `/repos/${repo}/releases?per_page=100`)).find(
      (x) => wire(x).draft && wire(x).tag_name === o.tag,
    );
    const fields = { tag_name: o.tag, target_commitish: o.sha, name: o.name, body: o.body, prerelease: !!o.prerelease };
    const r = draft
      ? await this.h.json('PATCH', `/repos/${repo}/releases/${idText(wire(draft).id)}`, { ...fields, draft: false })
      : await this.h.json('POST', `/repos/${repo}/releases`, fields);
    return {
      id: idText(wire(r).id),
      tag: o.tag,
      sha: o.sha,
      name: o.name,
      body: text(wire(r).body),
      url: field(r, 'html_url'),
      prerelease: !!o.prerelease,
      createdAt: maybeText(wire(r).created_at),
    };
  }
  async listTags(repo: RepoRef) {
    return (await this.h.paginate(`/repos/${repo}/tags?per_page=100`)).map((t) => field(t, 'name'));
  }
  async tagSha(repo: RepoRef, tag: string) {
    try {
      return field(await this.h.json('GET', `/repos/${repo}/commits/${enc(tag)}`), 'sha');
    } catch (e) {
      if (e instanceof GithubError && (e.status === 404 || e.status === 422)) return null;
      throw e;
    }
  }
  async updateRelease(repo: RepoRef, id: string, o: { body: string }) {
    const r = await this.h.json('PATCH', `/repos/${repo}/releases/${id}`, { body: o.body });
    return (await this.releaseOf(repo, r))!;
  }
  async latestRelease(repo: RepoRef) {
    try {
      return await this.releaseOf(repo, await this.h.json('GET', `/repos/${repo}/releases/latest`));
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return null;
      throw e;
    }
  }
  async listCommits(repo: RepoRef, o: { from?: string; to: string }) {
    const commits = o.from
      ? list(get(await this.h.json('GET', `/repos/${repo}/compare/${enc(o.from)}...${enc(o.to)}`), 'commits')).reverse()
      : list(await this.h.json('GET', `/repos/${repo}/commits?sha=${enc(o.to)}&per_page=100`));
    return commits.map((c) => ({ sha: field(c, 'sha'), message: field(get(c, 'commit'), 'message') }));
  }
  async latestDeployment(repo: RepoRef, environment: string): Promise<Deployment | null> {
    const [d] = list(await this.h.json('GET', `/repos/${repo}/deployments?environment=${enc(environment)}&per_page=1`));
    if (!d) return null;
    const statuses = await this.h.json('GET', `/repos/${repo}/deployments/${idText(wire(d).id)}/statuses?per_page=1`);
    const latest = wire(list(statuses)[0]);
    const state = DEPLOYMENT_STATES[text(latest.state)] ?? 'pending';
    return { sha: field(d, 'sha'), url: nullableText(latest.environment_url), state };
  }
  async commitEndpoint(_repo: RepoRef, o: { url: string; sha: string }) {
    return probeCommit(fetch, o);
  }
  async canWrite(repo: RepoRef) {
    return wire(get(await this.h.json('GET', `/repos/${repo}`), 'permissions')).push === true;
  }
}
