import type { RepoRef } from './contracts.js';
import { GitlabError } from './gitlab.js';
import { gitlabRelease, isGitlabPrerelease } from './gitlab-mappers.js';
import { GitlabMergeTrain } from './gitlab-merge-train.js';
import { field, get, list, text, wire } from './wire.js';

const enc = encodeURIComponent;

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
      await this.h.json('PUT', `/projects/${enc(repo)}/releases/${enc(id)}`, { description: o.body }),
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
}
