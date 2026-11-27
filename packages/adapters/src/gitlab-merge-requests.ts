import { IDEMPOTENT } from './retry.js';
import type {
  Check,
  InlineComment,
  NewPullRequest,
  PullRequest,
  PullRequestFile,
  RepoRef,
  ReviewThread,
} from './contracts.js';
import { gitlabAuthorId, gitlabMergeRequestFields } from './forge-fields.js';
import { GitlabForgeBase } from './gitlab-forge-base.js';
import { gitlabCheck, gitlabNote } from './gitlab-mappers.js';
import { field, get, idText, list, maybeText, num, text, wire } from './wire.js';

const enc = encodeURIComponent;
const PIPELINE_PENDING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled'];

const reviewThread = (d: unknown): ReviewThread => {
  const notes = list(wire(d).notes);
  return {
    id: idText(wire(d).id),
    body: field(notes[0], 'body'),
    resolved: notes.every((x) => !wire(x).resolvable || wire(x).resolved),
  };
};

const isInlineThread = (d: unknown): boolean => {
  const first = wire(list(wire(d).notes)[0]);
  return !!first.position && !!first.resolvable;
};

const fileStatus = (d: Record<string, unknown>): string => {
  if (d.new_file) return 'added';
  if (d.deleted_file) return 'removed';
  return d.renamed_file ? 'renamed' : 'modified';
};

const diffFile = (value: unknown): PullRequestFile => {
  const d = wire(value);
  const lines = text(d.diff).split('\n');
  return {
    filename: text(d.new_path),
    status: fileStatus(d),
    additions: lines.filter((l) => l.startsWith('+')).length,
    deletions: lines.filter((l) => l.startsWith('-')).length,
  };
};

/** Merge requests, discussions and pipelines. */
export class GitlabMergeRequests extends GitlabForgeBase {
  private paths = new Map<number, string>();

  private async pathOf(projectId: number): Promise<string> {
    let p = this.paths.get(projectId);
    if (!p) {
      p = field(await this.h.json('GET', `/projects/${projectId}`), 'path_with_namespace');
      this.paths.set(projectId, p);
    }
    return p;
  }
  private async headRepoOf(repo: RepoRef, w: Record<string, unknown>): Promise<string> {
    if (w.source_project_id == null) return '';
    const source = num(w.source_project_id);
    return w.source_project_id === w.target_project_id ? repo : this.pathOf(source);
  }
  private mergeable(w: Record<string, unknown>): Pick<PullRequest, 'mergeable'> {
    if (w.has_conflicts === true) return { mergeable: false };
    const unsettled = w.detailed_merge_status === 'checking' || w.detailed_merge_status === 'unchecked';
    return w.has_conflicts === false && !unsettled ? { mergeable: true } : {};
  }
  protected async pr(repo: RepoRef, m: unknown): Promise<PullRequest> {
    const w = wire(m);
    const merged = w.state === 'merged';
    const mergeSha = merged
      ? (maybeText(w.merge_commit_sha) ?? maybeText(w.squash_commit_sha) ?? maybeText(w.sha))
      : undefined;
    return {
      number: num(w.iid),
      url: text(w.web_url),
      title: text(w.title),
      body: text(w.description),
      state: merged ? 'merged' : w.state === 'opened' ? 'open' : 'closed',
      head: text(w.source_branch),
      base: text(w.target_branch),
      headSha: text(w.sha),
      headRepo: await this.headRepoOf(repo, w),
      baseRepo: repo,
      draft: !!(w.draft ?? w.work_in_progress),
      ...gitlabMergeRequestFields(m),
      authorTrusted: await this.h.trusted(repo, gitlabAuthorId(m)),
      ...this.mergeable(w),
      ...(w.detailed_merge_status === 'need_rebase' ? { behind: true } : {}),
      ...(mergeSha ? { mergeSha } : {}),
    };
  }

  async openPullRequest(repo: RepoRef, p: NewPullRequest) {
    return this.pr(
      repo,
      await this.h.json('POST', `/projects/${enc(repo)}/merge_requests`, {
        title: p.title,
        description: p.body ?? '',
        source_branch: p.head,
        target_branch: p.base,
      }),
    );
  }
  async getPullRequest(repo: RepoRef, n: number) {
    return this.pr(repo, await this.h.json('GET', `/projects/${enc(repo)}/merge_requests/${n}`));
  }
  async listPullRequests(repo: RepoRef, state: 'open' | 'closed' | 'all' = 'open', head?: string) {
    const q = state === 'open' ? 'opened' : 'all';
    const byHead = head ? `&source_branch=${enc(head)}` : '';
    const prs = await Promise.all(
      (await this.h.paginate(`/projects/${enc(repo)}/merge_requests?state=${q}&per_page=100${byHead}`)).map((m) =>
        this.pr(repo, m),
      ),
    );
    return state === 'closed' ? prs.filter((p) => p.state !== 'open') : prs;
  }
  async listOpenPullRequests(repo: RepoRef, page: number, perPage: number) {
    const query = `state=opened&order_by=updated_at&sort=desc&per_page=${perPage}&page=${page}`;
    const merges = list(await this.h.json('GET', `/projects/${enc(repo)}/merge_requests?${query}`));
    return Promise.all(merges.map((m) => this.pr(repo, m)));
  }
  async listMergedPullRequests(repo: RepoRef, limit: number) {
    const query = `state=merged&order_by=updated_at&sort=desc&per_page=${Math.min(limit, 100)}`;
    const ms = list(await this.h.json('GET', `/projects/${enc(repo)}/merge_requests?${query}`));
    return Promise.all(ms.map((m) => this.pr(repo, m)));
  }
  async closePullRequest(repo: RepoRef, n: number) {
    await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${n}`, { state_event: 'close' }, IDEMPOTENT);
  }
  async retargetPullRequest(repo: RepoRef, n: number, base: string) {
    await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${n}`, { target_branch: base }, IDEMPOTENT);
  }
  async commentOnPullRequest(repo: RepoRef, n: number, body: string) {
    return gitlabNote(await this.h.json('POST', `/projects/${enc(repo)}/merge_requests/${n}/notes`, { body }));
  }
  async reviewPullRequest(repo: RepoRef, n: number, r: { body: string; comments: InlineComment[] }) {
    if (r.comments.length) {
      const refs = get(await this.h.json('GET', `/projects/${enc(repo)}/merge_requests/${n}`), 'diff_refs');
      for (const c of r.comments) {
        await this.h.json('POST', `/projects/${enc(repo)}/merge_requests/${n}/discussions`, {
          body: c.body,
          position: {
            position_type: 'text',
            base_sha: field(refs, 'base_sha'),
            start_sha: field(refs, 'start_sha'),
            head_sha: field(refs, 'head_sha'),
            new_path: c.path,
            new_line: c.line,
          },
        });
      }
    }
    return this.commentOnPullRequest(repo, n, r.body);
  }
  async listReviewThreads(repo: RepoRef, n: number) {
    const all = await this.h.paginate(`/projects/${enc(repo)}/merge_requests/${n}/discussions?per_page=100`);
    return all.filter(isInlineThread).map(reviewThread);
  }
  async resolveReviewThread(repo: RepoRef, n: number, threadId: string) {
    const url = `/projects/${enc(repo)}/merge_requests/${n}/discussions/${threadId}?resolved=true`;
    await this.h.json('PUT', url, undefined, IDEMPOTENT);
  }
  async listPullRequestComments(repo: RepoRef, n: number) {
    const notes = await this.h.paginate(
      `/projects/${enc(repo)}/merge_requests/${n}/notes?sort=asc&order_by=created_at&per_page=100`,
    );
    return notes.filter((m) => !wire(m).system).map(gitlabNote);
  }
  async listPullRequestFiles(repo: RepoRef, n: number): Promise<PullRequestFile[]> {
    return (await this.h.paginate(`/projects/${enc(repo)}/merge_requests/${n}/diffs?per_page=100`)).map(diffFile);
  }
  async rerunFailed(repo: RepoRef, checks: Check[]): Promise<boolean> {
    const runs = [...new Set(checks.map((c) => c.runId).filter((r): r is number => !!r))];
    await Promise.all(runs.map((r) => this.h.json('POST', `/projects/${enc(repo)}/pipelines/${r}/retry`)));
    return runs.length > 0;
  }
  async listChecks(repo: RepoRef, sha: string): Promise<Check[]> {
    const [latest] = list(await this.h.json('GET', `/projects/${enc(repo)}/pipelines?sha=${enc(sha)}&per_page=1`));
    if (!latest) return [];
    const pipelineId = num(wire(latest).id);
    const p = `/projects/${enc(repo)}/pipelines/${pipelineId}`;
    const jobs = (await this.h.paginate(`${p}/jobs?per_page=100`)).map((j) => ({
      ...gitlabCheck(j),
      runId: pipelineId,
    }));
    const checks = [...jobs, ...(await this.h.paginate(`${p}/bridges?per_page=100`)).map(gitlabCheck)];
    const synthetic = (status: Check['status'], conclusion: string | null): Check => ({
      id: pipelineId,
      name: 'pipeline',
      status,
      conclusion,
    });
    const status = wire(latest).status;
    if (status === 'failed' && !checks.some((c) => c.conclusion === 'failure'))
      checks.push(synthetic('completed', 'failure'));
    else if (status === 'canceled' && !checks.some((c) => c.conclusion === 'cancelled'))
      checks.push(synthetic('completed', 'cancelled'));
    else if (!checks.length && PIPELINE_PENDING.includes(text(status))) checks.push(synthetic('in_progress', null));
    return checks;
  }
}
