import type {
  Backend, Branch, Capabilities, Check, CloseReason, Comment, Forge, LabelEvent, ListOptions, NewPullRequest, NewTicket,
  PullRequest, PullRequestFile, Release, RepoRef, Repository, Ticket, TicketSource, TicketSummary,
} from './contracts.js';
import { Conflict, MergePendingError, NotQueueableError } from './contracts.js';
import { parseRelations, renderRelations } from './body-convention.js';
import { MAX_WAIT_MS } from './github.js';
import { timedFetch } from './http.js';
import { closeReasonLabel } from './stage.js';

export interface GitlabAuth {
  token(): Promise<string>;
}

/** Personal / group service-account access token (scope `api`), sent as `PRIVATE-TOKEN`. */
export const gitlabPat = (token: string): GitlabAuth => ({ token: async () => token });

export class GitlabError extends Error {
  constructor(readonly status: number, method: string, path: string, detail: string) {
    super(`GitLab ${method} ${path} -> ${status}: ${detail.slice(0, 300)}`);
  }
}

export interface GitlabOptions {
  auth: GitlabAuth;
  /** Web origin, e.g. `https://gitlab.com`; the API lives at `<baseUrl>/api/v4`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

/** Minimal REST client: `Link rel="next"` pagination, backoff on 429 honouring Retry-After. */
export class GitlabHttp {
  private base: string;
  private doFetch: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;
  constructor(private o: GitlabOptions) {
    this.base = `${(o.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')}/api/v4`;
    this.doFetch = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 3;
  }

  async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith('http') ? path : this.base + path;
    for (let attempt = 0; ; attempt++) {
      const res = await timedFetch(this.doFetch, url, {
        cache: 'no-store',
        method,
        headers: {
          'private-token': await this.o.auth.token(),
          accept: 'application/json',
          'user-agent': 'bauherr',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, this.o.timeoutMs);
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Number(res.headers.get('retry-after') ?? 60) * 1000;
        if (wait > MAX_WAIT_MS) throw new GitlabError(429, method, path, `rate limited for ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) throw new GitlabError(res.status, method, path, await res.text());
      return res;
    }
  }

  async json<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async paginate<T = any>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const res: Response = await this.raw('GET', next);
      out.push(...((await res.json()) as T[]));
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
      if (next && new URL(next, this.base).origin !== new URL(this.base).origin) {
        throw new GitlabError(0, 'GET', path, `refusing to follow a Link to another origin: ${new URL(next, this.base).origin}`);
      }
    }
    return out;
  }
}

const enc = encodeURIComponent;
/** The contract wants whole seconds (GitHub shape); GitLab adds millis. */
const secs = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z');
const REASONS: CloseReason[] = ['completed', 'not_planned', 'duplicate'];

const summary = (i: any): TicketSummary => ({
  id: String(i.iid), number: i.iid, url: i.web_url, title: i.title, state: i.state === 'opened' ? 'open' : 'closed',
  labels: i.labels ?? [], assignee: i.assignees?.[0]?.username ?? null, assignees: (i.assignees ?? []).map((a: any) => a.username),
  updatedAt: secs(i.updated_at),
});
const note = (c: any): Comment => ({ id: String(c.id), author: c.author?.username ?? '', body: c.body ?? '', createdAt: secs(c.created_at) });

export class GitlabBackend implements Backend {
  readonly capabilities: Capabilities = { attachments: false, nativeSubTickets: false, nativeBlocking: false, webhooks: false };
  readonly forge: Forge;
  private http: GitlabHttp;
  constructor(o: GitlabOptions) {
    this.http = new GitlabHttp(o);
    this.forge = new GitlabForge(this.http, o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
  }
  tickets(repo: RepoRef): TicketSource {
    return new GitlabTickets(this.http, repo);
  }
}

class GitlabTickets implements TicketSource {
  private p: string;
  constructor(private h: GitlabHttp, repo: RepoRef) {
    this.p = `/projects/${enc(repo)}`;
  }
  private issue(id: string) {
    return this.h.json('GET', `${this.p}/issues/${id}`);
  }
  private edit(id: string, body: Record<string, unknown>) {
    return this.h.json('PUT', `${this.p}/issues/${id}`, body);
  }
  private async userId(login: string): Promise<number | null> {
    return (await this.h.json('GET', `/users?username=${enc(login)}`))[0]?.id ?? null;
  }
  private async children(parentId: string): Promise<any[]> {
    const q = new URLSearchParams({ search: `Parent: #${parentId}`, in: 'description', state: 'all', per_page: '100' });
    return (await this.h.paginate(`${this.p}/issues?${q}`)).filter((i) => parseRelations(i.description ?? '').relations.parent === parentId);
  }

  async list(opts: ListOptions = {}) {
    const q = new URLSearchParams({ state: { open: 'opened', closed: 'closed', all: 'all' }[opts.state ?? 'open'], per_page: '100' });
    if (opts.labels?.length) q.set('labels', opts.labels.join(','));
    return (await this.h.paginate(`${this.p}/issues?${q}`)).map(summary);
  }
  async get(id: string): Promise<Ticket> {
    const i = await this.issue(id);
    const { body, relations } = parseRelations(i.description ?? '');
    const closed = i.state !== 'opened';
    return {
      ...summary(i), body, parent: relations.parent, blockedBy: relations.blockedBy, links: relations.links,
      closeReason: closed ? (REASONS.find((r) => (i.labels as string[]).includes(closeReasonLabel(r))) ?? 'completed') : null,
    };
  }
  async poll(cursor: string | null) {
    const q = new URLSearchParams({ state: 'all', order_by: 'updated_at', sort: 'asc', per_page: '100' });
    if (cursor !== null) q.set('updated_after', new Date(cursor).toISOString());
    const changes = (await this.h.paginate(`${this.p}/issues?${q}`)).map(summary);
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }
  async create(t: NewTicket) {
    const i = await this.h.json('POST', `${this.p}/issues`, { title: t.title, description: t.body ?? '', labels: (t.labels ?? []).join(',') });
    return this.get(String(i.iid));
  }
  async comment(id: string, body: string) {
    return note(await this.h.json('POST', `${this.p}/issues/${id}/notes`, { body }));
  }
  async updateComment(id: string, commentId: string, body: string) {
    return note(await this.h.json('PUT', `${this.p}/issues/${id}/notes/${commentId}`, { body }));
  }
  async listComments(id: string, since?: string) {
    const notes = (await this.h.paginate(`${this.p}/issues/${id}/notes?sort=asc&order_by=created_at&per_page=100`)).filter((n) => !n.system);
    return notes.filter((n) => !since || Date.parse(n.updated_at) >= Date.parse(since)).map(note);
  }
  async addLabels(id: string, labels: string[]) {
    await this.edit(id, { add_labels: labels.join(',') });
  }
  async removeLabels(id: string, labels: string[]) {
    await this.edit(id, { remove_labels: labels.join(',') });
  }
  async claim(id: string, assignee: string) {
    const uid = await this.userId(assignee);
    const fail = () => Object.assign(new Error(`claim failed: ${assignee} not assigned to #${id}`), { status: 422 });
    if (uid === null) throw fail();
    const ids = ((await this.issue(id)).assignees as any[]).map((a) => a.id);
    const i = await this.edit(id, { assignee_ids: [...new Set([...ids, uid])] });
    if (!i.assignees.some((a: any) => a.username.toLowerCase() === assignee.toLowerCase())) throw fail();
  }
  async release(id: string) {
    await this.edit(id, { assignee_ids: [] });
  }
  async userExists(login: string) {
    return (await this.userId(login)) !== null;
  }
  async labelEvents(id: string): Promise<LabelEvent[]> {
    return (await this.h.paginate(`${this.p}/issues/${id}/resource_label_events?per_page=100`)).filter((e) => e.label).map((e) => ({
      label: e.label.name, action: e.action === 'add' ? 'labeled' : 'unlabeled', actor: e.user?.username ?? null, at: secs(e.created_at),
    }));
  }
  async whoami() {
    return (await this.h.json('GET', '/user')).username ?? null;
  }
  async unassign(id: string, assignees: string[]) {
    if (!assignees.length) return;
    const drop = assignees.map((a) => a.toLowerCase());
    const keep = ((await this.issue(id)).assignees as any[]).filter((a) => !drop.includes(a.username.toLowerCase())).map((a) => a.id);
    await this.edit(id, { assignee_ids: keep });
  }
  async close(id: string, reason: CloseReason) {
    await this.edit(id, { state_event: 'close', add_labels: closeReasonLabel(reason) });
  }
  async reopen(id: string) {
    const closed = (await this.issue(id)).state !== 'opened';
    await this.edit(id, { ...(closed ? { state_event: 'reopen' } : {}), remove_labels: REASONS.map(closeReasonLabel).join(',') });
  }
  private async setRelations(id: string, change: (r: ReturnType<typeof parseRelations>['relations']) => void) {
    const i = await this.issue(id);
    const { relations } = parseRelations(i.description ?? '');
    change(relations);
    await this.edit(id, { description: renderRelations(i.description ?? '', relations) });
  }
  async addSubTicket(parentId: string, childId: string) {
    await this.issue(parentId);
    await this.setRelations(childId, (r) => {
      if (r.parent) throw new Error('Sub issue may only have one parent');
      r.parent = parentId;
    });
  }
  async listSubTickets(parentId: string) {
    return (await this.children(parentId)).map(summary);
  }
  async addBlockedBy(id: string, blockerId: string) {
    await this.issue(blockerId);
    await this.setRelations(id, (r) => {
      if (r.blockedBy.includes(blockerId)) throw new Error('already blocked');
      r.blockedBy.push(blockerId);
    });
  }
  async addLink(id: string, url: string) {
    await this.setRelations(id, (r) => void r.links.push(url));
  }
  async frontier(parentId: string) {
    const open = (await this.children(parentId)).filter((i) => i.state === 'opened');
    const blocked = await Promise.all(open.map(async (i) => {
      const { blockedBy } = parseRelations(i.description ?? '').relations;
      return (await Promise.all(blockedBy.map((b) => this.issue(b)))).some((b) => b.state === 'opened');
    }));
    return open.filter((_, n) => !blocked[n]).map(summary);
  }
}

/** Waits between polls for an asynchronous merge (~30 s in total). */
const MERGE_POLL_MS = [500, 1000, 2000, 4000, 8000, 15000];
const PIPELINE_PENDING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled'];

const check = (j: any): Check => {
  const done = (conclusion: string): Check => ({ id: j.id, name: j.name, status: 'completed', conclusion });
  switch (j.status) {
    case 'success': return done('success');
    case 'failed': return done(j.allow_failure ? 'neutral' : 'failure');
    case 'canceled': return done('cancelled');
    case 'skipped': case 'manual': return done('skipped');
    default: return { id: j.id, name: j.name, status: 'in_progress', conclusion: null };
  }
};

class GitlabForge implements Forge {
  private paths = new Map<number, string>();
  constructor(private h: GitlabHttp, private sleep: (ms: number) => Promise<void>) {}
  private repo = (r: any): Repository => ({ fullName: r.path_with_namespace, defaultBranch: r.default_branch, private: r.visibility === 'private', url: r.web_url });
  private async pathOf(projectId: number): Promise<string> {
    let p = this.paths.get(projectId);
    if (!p) this.paths.set(projectId, (p = (await this.h.json('GET', `/projects/${projectId}`)).path_with_namespace as string));
    return p;
  }
  private async pr(repo: RepoRef, m: any): Promise<PullRequest> {
    const merged = m.state === 'merged';
    const mergeSha = merged ? (m.merge_commit_sha ?? m.squash_commit_sha ?? m.sha) : undefined;
    return {
      number: m.iid, url: m.web_url, title: m.title, body: m.description ?? '',
      state: merged ? 'merged' : m.state === 'opened' ? 'open' : 'closed',
      head: m.source_branch, base: m.target_branch, headSha: m.sha,
      headRepo: m.source_project_id == null ? '' : m.source_project_id === m.target_project_id ? repo : await this.pathOf(m.source_project_id),
      baseRepo: repo, draft: !!(m.draft ?? m.work_in_progress),
      ...(m.detailed_merge_status === 'need_rebase' ? { behind: true } : {}),
      ...(mergeSha ? { mergeSha } : {}),
    };
  }

  async listRepositories() {
    return (await this.h.paginate('/projects?membership=true&per_page=100')).map(this.repo);
  }
  async getRepository(repo: RepoRef) {
    return this.repo(await this.h.json('GET', `/projects/${enc(repo)}`));
  }
  async listBranches(repo: RepoRef): Promise<Branch[]> {
    return (await this.h.paginate(`/projects/${enc(repo)}/repository/branches?per_page=100`)).map((b) => ({ name: b.name, sha: b.commit.id }));
  }
  async getBranch(repo: RepoRef, name: string): Promise<Branch | null> {
    try {
      const b = await this.h.json('GET', `/projects/${enc(repo)}/repository/branches/${enc(name)}`);
      return { name, sha: b.commit.id };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }
  async createBranch(repo: RepoRef, name: string, from?: string): Promise<Branch> {
    const ref = from ?? (await this.getRepository(repo)).defaultBranch;
    const b = await this.h.json('POST', `/projects/${enc(repo)}/repository/branches?branch=${enc(name)}&ref=${enc(ref)}`);
    return { name, sha: b.commit.id };
  }
  async openPullRequest(repo: RepoRef, p: NewPullRequest) {
    return this.pr(repo, await this.h.json('POST', `/projects/${enc(repo)}/merge_requests`, {
      title: p.title, description: p.body ?? '', source_branch: p.head, target_branch: p.base,
    }));
  }
  async getPullRequest(repo: RepoRef, n: number) {
    return this.pr(repo, await this.h.json('GET', `/projects/${enc(repo)}/merge_requests/${n}`));
  }
  async listPullRequests(repo: RepoRef, state: 'open' | 'closed' | 'all' = 'open') {
    const q = state === 'open' ? 'opened' : 'all';
    const prs = await Promise.all((await this.h.paginate(`/projects/${enc(repo)}/merge_requests?state=${q}&per_page=100`)).map((m) => this.pr(repo, m)));
    return state === 'closed' ? prs.filter((p) => p.state !== 'open') : prs;
  }
  async listMergedPullRequests(repo: RepoRef, limit: number) {
    const ms = await this.h.json('GET', `/projects/${enc(repo)}/merge_requests?state=merged&order_by=updated_at&sort=desc&per_page=${Math.min(limit, 100)}`);
    return Promise.all((ms as any[]).map((m) => this.pr(repo, m)));
  }
  async closePullRequest(repo: RepoRef, n: number) {
    await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${n}`, { state_event: 'close' });
  }
  async commentOnPullRequest(repo: RepoRef, n: number, body: string) {
    return note(await this.h.json('POST', `/projects/${enc(repo)}/merge_requests/${n}/notes`, { body }));
  }
  async listPullRequestComments(repo: RepoRef, n: number) {
    return (await this.h.paginate(`/projects/${enc(repo)}/merge_requests/${n}/notes?sort=asc&order_by=created_at&per_page=100`)).filter((m) => !m.system).map(note);
  }
  async listPullRequestFiles(repo: RepoRef, n: number): Promise<PullRequestFile[]> {
    return (await this.h.paginate(`/projects/${enc(repo)}/merge_requests/${n}/diffs?per_page=100`)).map((d) => {
      const lines: string[] = (d.diff ?? '').split('\n');
      return {
        filename: d.new_path, status: d.new_file ? 'added' : d.deleted_file ? 'removed' : d.renamed_file ? 'renamed' : 'modified',
        additions: lines.filter((l) => l.startsWith('+')).length, deletions: lines.filter((l) => l.startsWith('-')).length,
      };
    });
  }
  async rerunFailed(repo: RepoRef, checks: Check[]): Promise<boolean> {
    const runs = [...new Set(checks.map((c) => c.runId).filter((r): r is number => !!r))];
    await Promise.all(runs.map((r) => this.h.json('POST', `/projects/${enc(repo)}/pipelines/${r}/retry`)));
    return runs.length > 0;
  }
  async listChecks(repo: RepoRef, sha: string): Promise<Check[]> {
    const [latest] = await this.h.json('GET', `/projects/${enc(repo)}/pipelines?sha=${enc(sha)}&per_page=1`);
    if (!latest) return [];
    const p = `/projects/${enc(repo)}/pipelines/${latest.id}`;
    const jobs = (await this.h.paginate(`${p}/jobs?per_page=100`)).map((j) => ({ ...check(j), runId: latest.id as number }));
    const checks = [...jobs, ...(await this.h.paginate(`${p}/bridges?per_page=100`)).map(check)];
    const synthetic = (status: Check['status'], conclusion: string | null): Check => ({ id: latest.id, name: 'pipeline', status, conclusion });
    if (latest.status === 'failed' && !checks.some((c) => c.conclusion === 'failure')) checks.push(synthetic('completed', 'failure'));
    else if (latest.status === 'canceled' && !checks.some((c) => c.conclusion === 'cancelled')) checks.push(synthetic('completed', 'cancelled'));
    else if (!checks.length && PIPELINE_PENDING.includes(latest.status)) checks.push(synthetic('in_progress', null));
    return checks;
  }
  async getCommitDate(repo: RepoRef, sha: string) {
    return (await this.h.json('GET', `/projects/${enc(repo)}/repository/commits/${enc(sha)}`)).committed_date as string;
  }
  private release(r: any): Release {
    return { id: r.tag_name, tag: r.tag_name, sha: r.commit?.id ?? '', name: r.name ?? r.tag_name, body: r.description ?? '', url: r._links.self, createdAt: r.created_at ?? r.released_at };
  }
  async findRelease(repo: RepoRef, o: { sha: string }) {
    const tags = new Set<string>((await this.h.json('GET', `/projects/${enc(repo)}/repository/commits/${enc(o.sha)}/refs?type=tag&per_page=100`)).map((t: any) => t.name));
    const r = (await this.h.json('GET', `/projects/${enc(repo)}/releases?per_page=30`)).filter((x: any) => tags.has(x.tag_name)).at(-1);
    return r ? this.release(r) : null;
  }
  async listReleases(repo: RepoRef) {
    return (await this.h.json('GET', `/projects/${enc(repo)}/releases?per_page=30`)).map((r: any) => this.release(r));
  }
  async releaseByTag(repo: RepoRef, tag: string) {
    try {
      return this.release(await this.h.json('GET', `/projects/${enc(repo)}/releases/${enc(tag)}`));
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return null;
      throw e;
    }
  }
  async isAncestor(repo: RepoRef, base: string, head: string) {
    const baseSha = (await this.h.json('GET', `/projects/${enc(repo)}/repository/commits/${enc(base)}`)).id as string;
    return (await this.h.json('GET', `/projects/${enc(repo)}/repository/merge_base?refs[]=${enc(base)}&refs[]=${enc(head)}`)).id === baseSha;
  }
  async createRelease(repo: RepoRef, o: { tag: string; sha: string; name: string; body: string; prerelease?: boolean }) {
    return this.release(await this.h.json('POST', `/projects/${enc(repo)}/releases`, { tag_name: o.tag, ref: o.sha, name: o.prerelease ? `${o.name} (pre-release)` : o.name, description: o.body }));
  }
  async listTags(repo: RepoRef) {
    return (await this.h.paginate(`/projects/${enc(repo)}/repository/tags?per_page=100`)).map((t) => t.name as string);
  }
  async updateRelease(repo: RepoRef, id: string, o: { body: string }) {
    return this.release(await this.h.json('PUT', `/projects/${enc(repo)}/releases/${enc(id)}`, { description: o.body }));
  }
  async latestRelease(repo: RepoRef) {
    const r = (await this.h.json('GET', `/projects/${enc(repo)}/releases?per_page=30`)).find((x: any) => !/^v?\d+\.\d+\.\d+-/.test(x.tag_name));
    return r ? this.release(r) : null;
  }
  async listCommits(repo: RepoRef, o: { from?: string; to: string }) {
    const commits: any[] = o.from
      ? (await this.h.json('GET', `/projects/${enc(repo)}/repository/compare?from=${enc(o.from)}&to=${enc(o.to)}`)).commits.reverse()
      : await this.h.json('GET', `/projects/${enc(repo)}/repository/commits?ref_name=${enc(o.to)}&per_page=100`);
    return commits.map((c) => ({ sha: c.id as string, message: c.message as string }));
  }
  async listFiles(repo: RepoRef, ref?: string) {
    const c = await this.h.json('GET', `/projects/${enc(repo)}/repository/commits/${enc(ref ?? (await this.getRepository(repo)).defaultBranch)}`);
    const tree = await this.h.paginate(`/projects/${enc(repo)}/repository/tree?ref=${enc(c.id)}&recursive=true&per_page=100`);
    return { commit: c.id as string, paths: tree.filter((t) => t.type === 'blob').map((t) => t.path as string) };
  }
  private async file(repo: RepoRef, path: string, ref: string) {
    return this.h.json('GET', `/projects/${enc(repo)}/repository/files/${enc(path)}?ref=${enc(ref)}`);
  }
  async getFile(repo: RepoRef, path: string, ref?: string) {
    const f = await this.file(repo, path, ref ?? (await this.getRepository(repo)).defaultBranch);
    return { content: Buffer.from(f.content, 'base64').toString('utf8'), sha: f.blob_id as string };
  }
  /** GitLab has no blob-sha precondition: check `expectSha` against the branch, then pin the write to that file's `last_commit_id`. */
  async putFile(repo: RepoRef, o: { branch: string; path: string; content: string; message: string; expectSha?: string }) {
    const cur = await this.file(repo, o.path, o.branch).catch((e) => (e instanceof GitlabError && e.status === 404 ? null : Promise.reject(e)));
    if (o.expectSha !== undefined && (cur?.blob_id ?? '') !== o.expectSha) throw new Conflict(`${o.path} changed`);
    try {
      await this.h.json(cur ? 'PUT' : 'POST', `/projects/${enc(repo)}/repository/files/${enc(o.path)}`, {
        branch: o.branch, content: o.content, commit_message: o.message, ...(cur ? { last_commit_id: cur.last_commit_id } : {}),
      });
    } catch (e) {
      if (e instanceof GitlabError && (e.status === 400 || e.status === 409)) throw new Conflict(e.message);
      throw e;
    }
    return { sha: (await this.file(repo, o.path, o.branch)).blob_id as string };
  }
  async retargetPullRequest(repo: RepoRef, n: number, base: string) {
    await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${n}`, { target_branch: base });
  }
  async queueSupport(repo: RepoRef) {
    const p = await this.h.json('GET', `/projects/${enc(repo)}`);
    return !!(p.merge_trains_enabled && p.merge_pipelines_enabled);
  }
  async requiredChecks() {
    return [];
  }
  async enqueuePullRequest(repo: RepoRef, n: number, o: { expectSha: string }) {
    const before = await this.getPullRequest(repo, n);
    if (before.state === 'merged') return { state: 'merged' as const, ...(before.mergeSha ? { mergeSha: before.mergeSha } : {}) };
    try {
      await this.h.json('POST', `/projects/${enc(repo)}/merge_trains/merge_requests/${n}`, { sha: o.expectSha, auto_merge: true, squash: true });
    } catch (e) {
      if (e instanceof GitlabError && [400, 405].includes(e.status)) throw new NotQueueableError(e.message);
      throw e;
    }
    return { state: 'queued' as const };
  }
  async isQueued(repo: RepoRef, n: number) {
    try {
      return ['idle', 'fresh', 'stale'].includes((await this.h.json('GET', `/projects/${enc(repo)}/merge_trains/merge_requests/${n}`)).status);
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return false;
      throw e;
    }
  }
  async dequeuePullRequest(repo: RepoRef, n: number) {
    try {
      await this.h.json('POST', `/projects/${enc(repo)}/merge_requests/${n}/cancel_merge_when_pipeline_succeeds`);
    } catch (e) {
      if (!(e instanceof GitlabError && [404, 405, 406].includes(e.status))) throw e; // nothing set to cancel
    }
  }
  async resetBranch(repo: RepoRef, branch: string, sha: string) {
    await this.h.json('DELETE', `/projects/${enc(repo)}/repository/branches/${enc(branch)}`).catch((e) => {
      if (!(e instanceof GitlabError && e.status === 404)) throw e;
    });
    await this.h.json('POST', `/projects/${enc(repo)}/repository/branches?branch=${enc(branch)}&ref=${enc(sha)}`);
  }
  async mergeIntoBranch(repo: RepoRef, branch: string, headSha: string) {
    const tip = (await this.getBranch(repo, branch))?.sha;
    if (!tip) throw new Error(`no branch ${branch}`);
    if (await this.isAncestor(repo, headSha, tip)) return { sha: tip };
    const temp = `${branch}-merge-${headSha.slice(0, 12)}`;
    const drop = () => this.h.json('DELETE', `/projects/${enc(repo)}/repository/branches/${enc(temp)}`).catch((e) => {
      if (!(e instanceof GitlabError && e.status === 404)) throw e;
    });
    await drop();
    await this.h.json('POST', `/projects/${enc(repo)}/repository/branches?branch=${enc(temp)}&ref=${enc(headSha)}`);
    const mr = await this.openPullRequest(repo, { title: `bauherr train: merge ${headSha.slice(0, 7)} into ${branch}`, head: temp, base: branch });
    try {
      await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${mr.number}/merge`, { squash: false, should_remove_source_branch: true, sha: headSha });
    } catch (e) {
      await this.closePullRequest(repo, mr.number).catch(() => undefined);
      await drop();
      if (e instanceof GitlabError && [405, 406].includes(e.status)) return { conflict: true as const };
      throw e;
    }
    let after = await this.getPullRequest(repo, mr.number);
    for (const ms of MERGE_POLL_MS) {
      if (after.state !== 'open') break;
      await this.sleep(ms);
      after = await this.getPullRequest(repo, mr.number);
    }
    if (after.state !== 'merged' || !after.mergeSha) throw new MergePendingError(`GitLab accepted the train merge of !${mr.number} but it is not merged yet`);
    await drop();
    return { sha: after.mergeSha };
  }
  async mergePullRequest(repo: RepoRef, n: number, o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string }) {
    const before = await this.getPullRequest(repo, n);
    let after = before;
    if (before.state !== 'merged') {
      const { squash_option } = await this.h.json('GET', `/projects/${enc(repo)}`);
      await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${n}/merge`, { squash: squash_option !== 'never', ...(o.expectSha ? { sha: o.expectSha } : {}) });
      after = await this.getPullRequest(repo, n);
      for (const ms of MERGE_POLL_MS) {
        if (after.state !== 'open') break;
        await this.sleep(ms);
        after = await this.getPullRequest(repo, n);
      }
    }
    if (after.state === 'open') throw new MergePendingError(`GitLab accepted the merge of !${n} but it is not merged yet`);
    if (!after.mergeSha) throw new GitlabError(0, 'PUT', `merge_requests/${n}/merge`, `merge of !${n} left no merge sha (state ${after.state})`);
    let branchDeleteError: string | undefined;
    if (o.deleteBranch && before.headRepo.toLowerCase() === before.baseRepo.toLowerCase()) {
      try {
        for (const s of await this.h.paginate(`/projects/${enc(repo)}/merge_requests?state=opened&target_branch=${enc(before.head)}&per_page=100`)) await this.retargetPullRequest(repo, s.iid, before.base);
      } catch (e) {
        return { mergeSha: after.mergeSha, branchDeleteError: `kept ${before.head}: retargeting stacked MRs failed: ${e instanceof Error ? e.message : String(e)}` };
      }
      await this.h.json('DELETE', `/projects/${enc(repo)}/repository/branches/${enc(before.head)}`).catch((e) => {
        if (!(e instanceof GitlabError && e.status === 404)) branchDeleteError = e instanceof Error ? e.message : String(e);
      });
    }
    return { mergeSha: after.mergeSha, ...(branchDeleteError ? { branchDeleteError } : {}) };
  }
}
