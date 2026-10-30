import { createHmac, createSign, timingSafeEqual } from 'node:crypto';
import type {
  Backend, Branch, Capabilities, Check, CloseReason, Comment, Forge, ListOptions, NewPullRequest, NewTicket,
  PullRequest, PullRequestFile, RepoRef, Repository, Ticket, TicketSource, TicketSummary, Webhooks,
} from './contracts.js';
import { parseRelations, renderRelations } from './body-convention.js';

export interface GithubAuth {
  kind: 'pat' | 'app';
  token(): Promise<string>;
}

export const patAuth = (token: string): GithubAuth => ({ kind: 'pat', token: async () => token });

export interface AppAuthOptions {
  appId: string | number;
  installationId: string | number;
  privateKeyPem: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Epoch ms; injectable for tests. */
  now?: () => number;
}

const b64url = (b: string | Buffer): string => Buffer.from(b).toString('base64url');

/** GitHub App installation tokens: RS256 JWT -> installation token, cached until 5 min before expiry. */
export function appAuth(o: AppAuthOptions): GithubAuth {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  const jwt = (): string => {
    const iat = Math.floor(now() / 1000) - 60;
    const data = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat, exp: iat + 540, iss: String(o.appId) }))}`;
    return `${data}.${createSign('RSA-SHA256').update(data).sign(o.privateKeyPem).toString('base64url')}`;
  };
  return {
    kind: 'app',
    async token() {
      if (cached && cached.expiresAt - 300_000 > now()) return cached.token;
      const res = await doFetch(`${o.baseUrl ?? 'https://api.github.com'}/app/installations/${o.installationId}/access_tokens`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt()}`, accept: 'application/vnd.github+json', 'user-agent': 'bauherr' },
      });
      if (!res.ok) throw new GithubError(res.status, 'POST', 'access_tokens', await res.text());
      const j = (await res.json()) as { token: string; expires_at: string };
      cached = { token: j.token, expiresAt: Date.parse(j.expires_at) };
      return cached.token;
    },
  };
}

export class GithubError extends Error {
  constructor(readonly status: number, method: string, path: string, detail: string) {
    super(`GitHub ${method} ${path} -> ${status}: ${detail.slice(0, 300)}`);
  }
}

export interface GithubOptions {
  auth: GithubAuth;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const MAX_WAIT_MS = 300_000;

/** Minimal REST client: Link pagination, backoff on 403/429 honouring Retry-After. */
export class Http {
  private base: string;
  private doFetch: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;
  constructor(private o: GithubOptions) {
    this.base = o.baseUrl ?? 'https://api.github.com';
    this.doFetch = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 3;
  }

  async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith('http') ? path : this.base + path;
    for (let attempt = 0; ; attempt++) {
      const res = await this.doFetch(url, {
        cache: 'no-store', // Next patches fetch; a cached poll response never advances the cursor
        method,
        headers: {
          authorization: `Bearer ${await this.o.auth.token()}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'bauherr',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const limited = res.status === 429 || (res.status === 403 && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0'));
      if (limited && attempt < this.maxRetries) {
        const retryAfter = res.headers.get('retry-after');
        const reset = res.headers.get('x-ratelimit-reset');
        const wait = retryAfter ? Number(retryAfter) * 1000 : reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 1000 : 60_000;
        if (wait > MAX_WAIT_MS) throw new GithubError(res.status, method, path, `rate limited for ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) throw new GithubError(res.status, method, path, await res.text());
      return res;
    }
  }

  async json<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Follows `Link: rel="next"`; `pick` unwraps envelope objects (e.g. `check_runs`). */
  async paginate<T = any>(path: string, pick?: (page: any) => T[]): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const res: Response = await this.raw('GET', next);
      const page = await res.json();
      out.push(...(pick ? pick(page) : (page as T[])));
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
    }
    return out;
  }
}

/** GitHub wants UTC with trailing `Z`; anything else silently returns nothing. */
const sinceParam = (iso: string): string => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const enc = encodeURIComponent;

const summary = (i: any): TicketSummary => ({
  id: String(i.number), number: i.number, url: i.html_url, title: i.title, state: i.state,
  labels: i.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
  assignee: i.assignee?.login ?? null, updatedAt: i.updated_at,
});
const comment = (c: any): Comment => ({ id: String(c.id), author: c.user?.login ?? '', body: c.body ?? '', createdAt: c.created_at });
const isIssue = (i: any): boolean => !i.pull_request;

export class GithubBackend implements Backend {
  readonly capabilities: Capabilities = { attachments: false, nativeSubTickets: true, nativeBlocking: true, webhooks: true };
  readonly forge: Forge;
  private http: Http;
  constructor(o: GithubOptions) {
    this.http = new Http(o);
    this.forge = new GithubForge(this.http, o.auth);
  }
  tickets(repo: RepoRef): TicketSource {
    return new GithubTickets(this.http, repo);
  }
}

class GithubTickets implements TicketSource {
  private p: string;
  constructor(private h: Http, repo: RepoRef) {
    this.p = `/repos/${repo}`;
  }
  private issue(id: string) {
    return this.h.json(`GET`, `${this.p}/issues/${id}`);
  }
  private async globalId(id: string): Promise<number> {
    return (await this.issue(id)).id;
  }
  private blockers(id: string): Promise<any[]> {
    return this.h.paginate(`${this.p}/issues/${id}/dependencies/blocked_by?per_page=100`);
  }

  async list(opts: ListOptions = {}) {
    const q = new URLSearchParams({ state: opts.state ?? 'open', per_page: '100' });
    if (opts.labels?.length) q.set('labels', opts.labels.join(','));
    return (await this.h.paginate(`${this.p}/issues?${q}`)).filter(isIssue).map(summary);
  }
  async get(id: string): Promise<Ticket> {
    const [i, blockers] = await Promise.all([this.issue(id), this.blockers(id)]);
    const { body, relations } = parseRelations(i.body ?? '');
    return {
      ...summary(i), body,
      parent: i.parent_issue_url ? String(i.parent_issue_url).split('/').at(-1)! : null,
      blockedBy: blockers.map((b) => String(b.number)),
      links: relations.links,
      closeReason: i.state === 'closed' ? (i.state_reason ?? 'completed') : null,
    };
  }
  async poll(cursor: string | null) {
    const q = new URLSearchParams({ state: 'all', sort: 'updated', direction: 'asc', per_page: '100' });
    if (cursor !== null) q.set('since', sinceParam(cursor));
    const changes = (await this.h.paginate(`${this.p}/issues?${q}`)).filter(isIssue).map(summary);
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }
  async create(t: NewTicket) {
    const i = await this.h.json('POST', `${this.p}/issues`, { title: t.title, body: t.body ?? '', labels: t.labels ?? [] });
    return this.get(String(i.number));
  }
  async comment(id: string, body: string) {
    return comment(await this.h.json('POST', `${this.p}/issues/${id}/comments`, { body }));
  }
  async updateComment(id: string, commentId: string, body: string) {
    return comment(await this.h.json('PATCH', `${this.p}/issues/comments/${commentId}`, { body }));
  }
  async listComments(id: string, since?: string) {
    const q = since ? `&since=${enc(sinceParam(since))}` : '';
    return (await this.h.paginate(`${this.p}/issues/${id}/comments?per_page=100${q}`)).map(comment);
  }
  async addLabels(id: string, labels: string[]) {
    await this.h.json('POST', `${this.p}/issues/${id}/labels`, { labels });
  }
  async removeLabels(id: string, labels: string[]) {
    for (const l of labels) {
      try {
        await this.h.json('DELETE', `${this.p}/issues/${id}/labels/${enc(l)}`);
      } catch (e) {
        if (!(e instanceof GithubError && e.status === 404)) throw e;
      }
    }
  }
  async claim(id: string, assignee: string) {
    const i = await this.h.json('POST', `${this.p}/issues/${id}/assignees`, { assignees: [assignee] });
    // GitHub silently drops invalid logins (201): verify.
    if (!i.assignees.some((a: any) => a.login.toLowerCase() === assignee.toLowerCase())) throw new Error(`claim failed: ${assignee} not assigned to #${id}`);
  }
  async release(id: string) {
    const assignees = ((await this.issue(id)).assignees as any[]).map((a) => a.login);
    if (assignees.length) await this.h.json('DELETE', `${this.p}/issues/${id}/assignees`, { assignees });
  }
  async close(id: string, reason: CloseReason) {
    await this.h.json('PATCH', `${this.p}/issues/${id}`, { state: 'closed', state_reason: reason });
  }
  async addSubTicket(parentId: string, childId: string) {
    await this.h.json('POST', `${this.p}/issues/${parentId}/sub_issues`, { sub_issue_id: await this.globalId(childId) });
  }
  async listSubTickets(parentId: string) {
    return (await this.h.paginate(`${this.p}/issues/${parentId}/sub_issues?per_page=100`)).map(summary);
  }
  async addBlockedBy(id: string, blockerId: string) {
    await this.h.json('POST', `${this.p}/issues/${id}/dependencies/blocked_by`, { issue_id: await this.globalId(blockerId) });
  }
  async addLink(id: string, url: string) {
    const i = await this.issue(id);
    const { relations } = parseRelations(i.body ?? '');
    relations.links.push(url);
    await this.h.json('PATCH', `${this.p}/issues/${id}`, { body: renderRelations(i.body ?? '', relations) });
  }
  async frontier(parentId: string) {
    const open = (await this.listSubTickets(parentId)).filter((s) => s.state === 'open');
    const blocked = await Promise.all(open.map(async (s) => (await this.blockers(s.id)).some((b) => b.state === 'open')));
    return open.filter((_, n) => !blocked[n]);
  }
}

const pr = (p: any): PullRequest => ({
  number: p.number, url: p.html_url, title: p.title, body: p.body ?? '',
  state: p.merged_at ? 'merged' : p.state, head: p.head.ref, base: p.base.ref, headSha: p.head.sha,
  ...(p.merge_commit_sha && p.merged_at ? { mergeSha: p.merge_commit_sha } : {}),
});

export const githubWebhooks = (h: Http): Webhooks => ({
  async register(repo, o) {
    const hook = await h.json('POST', `/repos/${repo}/hooks`, {
      name: 'web', active: true, events: o.events, config: { url: o.url, content_type: 'json', secret: o.secret },
    });
    return { id: String(hook.id) };
  },
  verify(rawBody, signature, secret) {
    if (!signature) return false;
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
    const got = Buffer.from(signature);
    return got.length === expected.length && timingSafeEqual(got, expected);
  },
});

class GithubForge implements Forge {
  webhooks: Webhooks;
  constructor(private h: Http, private auth: GithubAuth) {
    this.webhooks = githubWebhooks(h);
  }
  private repo = (r: any): Repository => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private, url: r.html_url });

  async listRepositories() {
    const repos = this.auth.kind === 'app'
      ? await this.h.paginate('/installation/repositories?per_page=100', (p) => p.repositories)
      : await this.h.paginate('/user/repos?per_page=100');
    return repos.map(this.repo);
  }
  async getRepository(repo: RepoRef) {
    return this.repo(await this.h.json('GET', `/repos/${repo}`));
  }
  async listBranches(repo: RepoRef): Promise<Branch[]> {
    return (await this.h.paginate(`/repos/${repo}/branches?per_page=100`)).map((b) => ({ name: b.name, sha: b.commit.sha }));
  }
  async createBranch(repo: RepoRef, name: string, from?: string): Promise<Branch> {
    const base = from ?? (await this.getRepository(repo)).defaultBranch;
    const ref = await this.h.json('GET', `/repos/${repo}/git/ref/heads/${base}`);
    const sha: string = ref.object.sha;
    await this.h.json('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${name}`, sha });
    return { name, sha };
  }
  async openPullRequest(repo: RepoRef, p: NewPullRequest) {
    return pr(await this.h.json('POST', `/repos/${repo}/pulls`, { title: p.title, body: p.body ?? '', head: p.head, base: p.base }));
  }
  async getPullRequest(repo: RepoRef, n: number) {
    return pr(await this.h.json('GET', `/repos/${repo}/pulls/${n}`));
  }
  async listPullRequests(repo: RepoRef, state: 'open' | 'closed' | 'all' = 'open') {
    return (await this.h.paginate(`/repos/${repo}/pulls?state=${state}&per_page=100`)).map(pr);
  }
  async commentOnPullRequest(repo: RepoRef, n: number, body: string) {
    return comment(await this.h.json('POST', `/repos/${repo}/issues/${n}/comments`, { body }));
  }
  async listPullRequestFiles(repo: RepoRef, n: number): Promise<PullRequestFile[]> {
    return (await this.h.paginate(`/repos/${repo}/pulls/${n}/files?per_page=100`)).map((f) => ({
      filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
    }));
  }
  async mergePullRequest(repo: RepoRef, n: number, o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string }) {
    const m = await this.h.json('PUT', `/repos/${repo}/pulls/${n}/merge`, { merge_method: o.method, ...(o.expectSha ? { sha: o.expectSha } : {}) });
    if (o.deleteBranch) {
      const head = (await this.getPullRequest(repo, n)).head;
      await this.h.json('DELETE', `/repos/${repo}/git/refs/heads/${head.split('/').map(encodeURIComponent).join('/')}`).catch(() => {});
    }
    return { mergeSha: m.sha as string };
  }
  async listChecks(repo: RepoRef, sha: string): Promise<Check[]> {
    return (await this.h.paginate(`/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`, (p) => p.check_runs)).map((c) => ({
      id: c.id, name: c.name, status: c.status, conclusion: c.conclusion,
    }));
  }
}
