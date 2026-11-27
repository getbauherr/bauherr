import { IDEMPOTENT } from './retry.js';
import type { Deployment, DeploymentState, RepoRef } from './contracts.js';
import { GitlabError } from './gitlab.js';
import { gitlabRelease, isGitlabPrerelease } from './gitlab-mappers.js';
import { GitlabMergeTrain } from './gitlab-merge-train.js';
import { probeCommit } from './release-probe.js';
import { field, get, list, nullableText, num, text, wire } from './wire.js';

const DEVELOPER = 30;
const UPCOMING_MS = 365 * 86_400_000;

const enc = encodeURIComponent;

const DEPLOYMENT_STATES: Record<string, DeploymentState> = {
  success: 'success',
  failed: 'failure',
  canceled: 'failure',
};

/** Releases, tags and commit ranges. */
export class GitlabReleases extends GitlabMergeTrain {
  async findRelease(repo: RepoRef, o: { sha: string }) {
    const refs = await this.h.json(
      'GET',
      `/projects/${enc(repo)}/repository/commits/${enc(o.sha)}/refs?type=tag&per_page=100`,
    );
    const tags = new Set<string>(list(refs).map((t) => field(t, 'name')));
    const r = list(await this.h.json('GET', `/projects/${enc(repo)}/releases?per_page=30`))
      .filter((x) => tags.has(field(x, 'tag_name')))
      .at(-1);
    return r ? gitlabRelease(r) : null;
  }
  async listReleases(repo: RepoRef) {
    return list(await this.h.json('GET', `/projects/${enc(repo)}/releases?per_page=30`)).map(gitlabRelease);
  }
  async releaseByTag(repo: RepoRef, tag: string) {
    try {
      return gitlabRelease(await this.h.json('GET', `/projects/${enc(repo)}/releases/${enc(tag)}`));
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return null;
      throw e;
    }
  }
  async createRelease(
    repo: RepoRef,
    o: { tag: string; sha: string; name: string; body: string; prerelease?: boolean },
  ) {
    return gitlabRelease(
      await this.h.json('POST', `/projects/${enc(repo)}/releases`, {
        tag_name: o.tag,
        ref: o.sha,
        name: o.prerelease ? `${o.name} (pre-release)` : o.name,
        description: o.body,
      }),
    );
  }
  async draftRelease(repo: RepoRef, o: { tag: string; sha: string; name: string; body: string }) {
    const known = await this.releaseByTag(repo, o.tag);
    if (known) return known;
    await this.h
      .json('POST', `/projects/${enc(repo)}/repository/tags`, { tag_name: o.tag, ref: o.sha })
      .catch((e: unknown) => {
        if (!(e instanceof GitlabError && e.status === 400)) throw e;
      });
    const upcoming = new Date(Date.now() + UPCOMING_MS).toISOString();
    const created = await this.h.json('POST', `/projects/${enc(repo)}/releases`, {
      tag_name: o.tag,
      ref: o.sha,
      name: o.name,
      description: o.body,
      released_at: upcoming,
    });
    return { ...gitlabRelease(created), draft: true };
  }
  async publishRelease(repo: RepoRef, id: string, o: { body: string }) {
    return gitlabRelease(
      await this.h.json('PUT', `/projects/${enc(repo)}/releases/${enc(id)}`, {
        description: o.body,
        released_at: new Date().toISOString(),
      }, IDEMPOTENT),
    );
  }
  async startDeploy(repo: RepoRef, o: { workflow: string; ref: string; inputs: Record<string, string> }) {
    const variables = Object.entries(o.inputs).map(([key, value]) => ({ key, value }));
    await this.h.json('POST', `/projects/${enc(repo)}/pipeline`, { ref: o.ref, variables });
  }
  async listTags(repo: RepoRef) {
    return (await this.h.paginate(`/projects/${enc(repo)}/repository/tags?per_page=100`)).map((t) => field(t, 'name'));
  }
  async tagSha(repo: RepoRef, tag: string) {
    try {
      const t = await this.h.json('GET', `/projects/${enc(repo)}/repository/tags/${enc(tag)}`);
      return field(get(t, 'commit'), 'id');
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return null;
      throw e;
    }
  }
  async updateRelease(repo: RepoRef, id: string, o: { body: string }) {
    return gitlabRelease(
      await this.h.json('PUT', `/projects/${enc(repo)}/releases/${enc(id)}`, { description: o.body }, IDEMPOTENT),
    );
  }
  async latestRelease(repo: RepoRef) {
    const r = list(await this.h.json('GET', `/projects/${enc(repo)}/releases?per_page=30`)).find(
      (x) => !isGitlabPrerelease(text(wire(x).tag_name)),
    );
    return r ? gitlabRelease(r) : null;
  }
  async listCommits(repo: RepoRef, o: { from?: string; to: string }) {
    const commits = o.from
      ? list(
          get(
            await this.h.json('GET', `/projects/${enc(repo)}/repository/compare?from=${enc(o.from)}&to=${enc(o.to)}`),
            'commits',
          ),
        ).reverse()
      : list(await this.h.json('GET', `/projects/${enc(repo)}/repository/commits?ref_name=${enc(o.to)}&per_page=100`));
    return commits.map((c) => ({ sha: field(c, 'id'), message: field(c, 'message') }));
  }
  async latestDeployment(repo: RepoRef, environment: string): Promise<Deployment | null> {
    const query = `environment=${enc(environment)}&order_by=created_at&sort=desc&per_page=1`;
    const path = `/projects/${enc(repo)}/deployments?${query}`;
    const [d] = list(await this.h.json('GET', path));
    if (!d) return null;
    return {
      sha: field(get(d, 'deployable', 'commit'), 'id') || field(d, 'sha'),
      url: nullableText(wire(get(d, 'environment')).external_url),
      state: DEPLOYMENT_STATES[text(wire(d).status)] ?? 'pending',
    };
  }
  async commitEndpoint(_repo: RepoRef, o: { url: string; sha: string }) {
    return probeCommit(fetch, o);
  }
  async canWrite(repo: RepoRef) {
    const access = get(await this.h.json('GET', `/projects/${enc(repo)}`), 'permissions');
    const level = (key: string) => num(wire(get(access, key)).access_level);
    return Math.max(level('project_access'), level('group_access')) >= DEVELOPER;
  }
}
