import type {
  Backend, Branch, Capabilities, Check, CloseReason, Comment, Forge, LabelEvent, ListOptions, NewPullRequest, NewTicket,
  PullRequest, PullRequestFile, Release, RepoRef, Repository, Ticket, TicketSource, TicketSummary,
} from './contracts.js';
import { parseRelations, renderRelations, type Relations } from './body-convention.js';
import { createHash } from 'node:crypto';
import { Conflict, type InlineComment, NotQueueableError, linkLabel } from './contracts.js';
import { closeReasonLabel } from './stage.js';
import { closingIssues } from './closing-issues.js';

interface FakeTicket {
  number: number; title: string; body: string; state: 'open' | 'closed'; labels: string[];
  assignees: string[]; author: string; createdAt: string; closedAt?: string; updatedAt: string;
  closeReason: CloseReason | null; rel: Relations; comments: Comment[]; events: LabelEvent[];
}
interface FakeRepo {
  defaultBranch: string;
  branches: Map<string, { sha: string; files: Map<string, string> }>;
  prs: PullRequest[];
  checks: Map<string, Check[]>;
  rerunChecks: Map<string, Check[]>;
  reruns: Check[][];
  reviews: { number: number; body: string; comments: InlineComment[] }[];
  resolvedThreads: Set<string>;
  commitDates: Map<string, string>;
  releases: Release[];
  tags: string[];
  tagShas: Map<string, string>;
  contains: Map<string, string[]>;
  commits: { sha: string; message: string }[];
  ancestors: Map<string, string[]>;
  queueSupport: boolean;
  requiredChecks: string[];
  queue: number[];
  issued: number;
  snapshots: Map<string, Map<string, string>>;
}

const blobSha = (c: string): string => createHash('sha1').update(c).digest('hex');

/** In-memory Backend. `native` = relations as fields; otherwise body convention + close-reason labels. */
export class FakeBackend implements Backend {
  readonly capabilities: Capabilities;
  readonly forge: Forge;
  private ticketSources = new Map<string, FakeTickets>();
  private repos = new Map<string, FakeRepo>();
  actingAs = 'factory';
  login: string | null = 'factory';
  private tick = 0;
  private seq = 0;

  constructor(
    readonly opts: { native: boolean; user?: string; users?: string[]; trusted?: string[]; bots?: string[] } = { native: true },
  ) {
    this.capabilities = {
      attachments: false, nativeSubTickets: opts.native, nativeBlocking: opts.native, webhooks: false,
    };
    this.forge = this.makeForge();
  }

  nextNumber(repo: RepoRef): number {
    return ++this.repo(repo).issued;
  }

  isTrusted(login: string): boolean {
    return this.opts.trusted === undefined || this.opts.trusted.includes(login);
  }

  isBot(login: string): boolean {
    return this.opts.bots?.includes(login) ?? false;
  }

  hideTicket(repo: RepoRef, number: number, hidden = true): void {
    (this.tickets(repo) as FakeTickets).hide(number, hidden);
  }

  private touchPr(pr: PullRequest): void {
    pr.updatedAt = this.now();
    if (pr.state === 'open') delete pr.closedAt;
    else pr.closedAt = pr.updatedAt;
  }

  now(): string {
    return new Date(Date.UTC(2026, 0, 1) + ++this.tick * 1000).toISOString().replace('.000Z', 'Z');
  }

  tickets(repo: RepoRef): TicketSource {
    let ts = this.ticketSources.get(repo);
    if (!ts) this.ticketSources.set(repo, (ts = new FakeTickets(this, repo)));
    return ts;
  }

  commit(repo: RepoRef, branch: string, path: string, content: string): string {
    const b = this.repo(repo).branches.get(branch);
    if (!b) throw new Error(`no branch ${branch}`);
    b.files.set(path, content);
    b.sha = `sha${++this.seq}`;
    this.repo(repo).snapshots.set(b.sha, new Map(b.files));
    for (const p of this.repo(repo).prs) if (p.head === branch) (delete p.mergeable, delete p.behind, this.touchPr(p));
    return b.sha;
  }

  failNext(op: 'addLabels' | 'removeLabels', times = 1): void {
    this.failures[op] = times;
  }
  failures = { addLabels: 0, removeLabels: 0 };
  maybeFail(op: 'addLabels' | 'removeLabels'): void {
    if (this.failures[op]-- > 0) throw Object.assign(new Error('503'), { status: 503 });
  }

  setMergeable(repo: RepoRef, number: number, value: boolean | undefined): void {
    this.setPullRequest(repo, number, { mergeable: value });
  }

  setBehind(repo: RepoRef, number: number, value: boolean | undefined): void {
    this.setPullRequest(repo, number, { behind: value });
  }

  merge(repo: RepoRef, number: number): string {
    const r = this.repo(repo);
    const pr = r.prs.find((p) => p.number === number);
    if (!pr) throw new Error(`no PR ${number}`);
    pr.state = 'merged';
    this.touchPr(pr);
    pr.mergeSha = `merge${++this.seq}`;
    return pr.mergeSha;
  }

  close(repo: RepoRef, number: number): void {
    const pr = this.repo(repo).prs.find((p) => p.number === number);
    if (!pr) throw new Error(`no PR ${number}`);
    pr.state = 'closed';
    this.touchPr(pr);
  }

  setChecks(repo: RepoRef, sha: string, checks: Check[]): void {
    this.repo(repo).checks.set(sha, checks);
  }

  setRerunChecks(repo: RepoRef, sha: string, checks: Check[]): void {
    this.repo(repo).rerunChecks.set(sha, checks);
  }

  reruns(repo: RepoRef): Check[][] {
    return this.repo(repo).reruns;
  }

  reviews(repo: RepoRef): { number: number; body: string; comments: InlineComment[] }[] {
    return this.repo(repo).reviews;
  }

  setPullRequest(repo: RepoRef, number: number, patch: Partial<PullRequest>): void {
    const pr = this.repo(repo).prs.find((p) => p.number === number);
    if (!pr) throw new Error(`no PR ${number}`);
    Object.assign(pr, patch);
    this.touchPr(pr);
  }

  setCommitDate(repo: RepoRef, sha: string, iso: string): void {
    this.repo(repo).commitDates.set(sha, iso);
  }

  addRelease(repo: RepoRef, o: { tag: string; sha: string; body?: string; contains?: string[]; prerelease?: boolean; createdAt?: number | string }): Release {
    const r = this.repo(repo);
    if (o.contains) r.contains.set(o.tag, o.contains);
    const rel: Release = { id: String(++this.seq), tag: o.tag, sha: o.sha, name: o.tag, body: o.body ?? '', url: `https://fake/${repo}/releases/tag/${o.tag}`, prerelease: !!o.prerelease, createdAt: new Date(o.createdAt ?? Date.now()).toISOString() };
    r.releases.push(rel);
    return rel;
  }

  addTag(repo: RepoRef, tag: string, sha?: string): void {
    const r = this.repo(repo);
    r.tags.push(tag);
    if (sha) r.tagShas.set(tag, sha);
  }

  listReleases(repo: RepoRef): Release[] {
    return [...this.repo(repo).releases];
  }

  setAncestors(repo: RepoRef, head: string, shas: string[]): void {
    this.repo(repo).ancestors.set(head, shas);
  }

  setCommits(repo: RepoRef, commits: { sha: string; message: string }[]): void {
    this.repo(repo).commits = commits;
  }

  setQueueSupport(repo: RepoRef, value: boolean): void {
    this.repo(repo).queueSupport = value;
  }

  setRequiredChecks(repo: RepoRef, names: string[]): void {
    this.repo(repo).requiredChecks = names;
  }

  advanceQueue(repo: RepoRef, o: { fail?: number[] } = {}): number | null {
    const r = this.repo(repo);
    const n = r.queue.shift();
    if (n === undefined) return null;
    if (!o.fail?.includes(n)) this.merge(repo, n);
    return n;
  }

  private repo(name: RepoRef): FakeRepo {
    let r = this.repos.get(name);
    if (!r) {
      r = { defaultBranch: 'main', branches: new Map([['main', { sha: `sha${++this.seq}`, files: new Map() }]]), prs: [], checks: new Map(), rerunChecks: new Map(), reruns: [], reviews: [], resolvedThreads: new Set(), commitDates: new Map(), releases: [], tags: [], tagShas: new Map(), contains: new Map(), commits: [], ancestors: new Map(), queueSupport: false, requiredChecks: [], queue: [], issued: 0, snapshots: new Map() };
      r.snapshots.set(r.branches.get('main')!.sha, new Map());
      this.repos.set(name, r);
    }
    return r;
  }

  private makeForge(): Forge {
    const sha = (r: FakeRepo, b: string) => r.branches.get(b)?.sha ?? '';
    const find = (repo: RepoRef, n: number) => {
      const pr = this.repo(repo).prs.find((p) => p.number === n);
      if (!pr) throw new Error(`no PR ${n}`);
      if (pr.state === 'open') pr.headSha = sha(this.repo(repo), pr.head) || pr.headSha;
      return pr;
    };
    const comments = new Map<string, Comment[]>();
    const post = (repo: RepoRef, n: number, body: string) => {
      find(repo, n);
      const at = this.now();
      const c: Comment = { id: String(++this.seq), author: this.actingAs, body, createdAt: at, updatedAt: at };
      comments.set(`${repo}#${n}`, [...(comments.get(`${repo}#${n}`) ?? []), c]);
      return c;
    };
    const view = (repo: RepoRef, name: string): Repository => ({
      fullName: name, defaultBranch: this.repo(repo).defaultBranch, private: true, url: `https://fake/${name}`,
    });
    return {
      linkLabel: (pr) => linkLabel('github', pr.number),
      listRepositories: async () => [...this.repos.keys()].map((n) => view(n, n)),
      getRepository: async (repo) => view(repo, repo),
      listBranches: async (repo) => [...this.repo(repo).branches].map(([name, b]): Branch => ({ name, sha: b.sha })),
      getBranch: async (repo, name) => {
        const b = this.repo(repo).branches.get(name);
        return b ? { name, sha: b.sha } : null;
      },
      createBranch: async (repo, name, from) => {
        const r = this.repo(repo);
        const src = r.branches.get(from ?? r.defaultBranch);
        if (!src) throw new Error(`no branch ${from}`);
        if (r.branches.has(name)) throw new Error(`branch exists ${name}`);
        r.branches.set(name, { sha: src.sha, files: new Map(src.files) });
        return { name, sha: src.sha };
      },
      openPullRequest: async (repo, pr: NewPullRequest) => {
        const r = this.repo(repo);
        const number = this.nextNumber(repo);
        const created: PullRequest = {
          number, url: `https://github.com/${repo}/pull/${number}`, title: pr.title,
          body: pr.body ?? '', state: 'open', head: pr.head, base: pr.base, headSha: sha(r, pr.head),
          headRepo: repo, baseRepo: repo, draft: false, author: this.actingAs,
          authorTrusted: this.isTrusted(this.actingAs), authorIsBot: this.isBot(this.actingAs),
          createdAt: this.now(), updatedAt: '', labels: [], assignees: [], closes: closingIssues(pr.body ?? ''),
        };
        created.updatedAt = created.createdAt;
        r.prs.push(created);
        return created;
      },
      getPullRequest: async (repo, n) => find(repo, n),
      listPullRequests: async (repo, state = 'open', head) =>
        this.repo(repo).prs.filter((p) => (state === 'all' || (state === 'open') === (p.state === 'open')) && (!head || p.head === head)),
      listOpenPullRequests: async (repo, page, perPage) =>
        this.repo(repo).prs.filter((p) => p.state === 'open')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number)
          .slice((page - 1) * perPage, page * perPage),
      listMergedPullRequests: async (repo, limit) => this.repo(repo).prs.filter((p) => p.state === 'merged').slice(-limit).reverse(),
      closePullRequest: async (repo, n) => {
        const pr = find(repo, n);
        if (pr.state === 'open') this.close(repo, n);
      },
      commentOnPullRequest: async (repo, n, body) => post(repo, n, body),
      reviewPullRequest: async (repo, n, review) => {
        this.repo(repo).reviews.push({ number: n, ...review });
        return post(repo, n, review.body);
      },
      listReviewThreads: async (repo, n) => {
        find(repo, n);
        const r = this.repo(repo);
        return r.reviews.flatMap((x, i) => (x.number === n ? x.comments.map((c, j) => ({ id: `${i}.${j}`, body: c.body, resolved: r.resolvedThreads.has(`${i}.${j}`) })) : []));
      },
      resolveReviewThread: async (repo, n, threadId) => {
        find(repo, n);
        this.repo(repo).resolvedThreads.add(threadId);
      },
      listPullRequestComments: async (repo, n) => {
        find(repo, n);
        return comments.get(`${repo}#${n}`) ?? [];
      },
      listPullRequestFiles: async (repo, n) => {
        const r = this.repo(repo);
        const pr = find(repo, n);
        const base = r.branches.get(pr.base)?.files ?? new Map<string, string>();
        const out: PullRequestFile[] = [];
        for (const [filename, content] of r.branches.get(pr.head)?.files ?? []) {
          const old = base.get(filename);
          if (old === content) continue;
          out.push({ filename, status: old === undefined ? 'added' : 'modified', additions: content.split('\n').length, deletions: old === undefined ? 0 : old.split('\n').length });
        }
        return out;
      },
      compare: async (repo, base, head) => {
        const r = this.repo(repo);
        const files = (ref: string) => (r.branches.get(ref) ?? [...r.branches.values()].find((b) => b.sha === ref))?.files ?? new Map<string, string>();
        const [a, b] = [files(base), files(head)];
        return [...b].filter(([name, content]) => a.get(name) !== content).map(([name, content]) => `--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${content.split('\n').length} @@\n${content.split('\n').map((l) => `+${l}`).join('\n')}`).join('\n');
      },
      listChecks: async (repo, sha) => this.repo(repo).checks.get(sha) ?? [],
      rerunFailed: async (repo, checks) => {
        const r = this.repo(repo);
        r.reruns.push(checks);
        for (const [sha, next] of r.rerunChecks) r.checks.set(sha, next);
        r.rerunChecks.clear();
        return checks.length > 0 && checks.every((c) => c.runId);
      },
      listFiles: async (repo, ref) => {
        const r = this.repo(repo);
        const b = r.branches.get(ref ?? r.defaultBranch);
        if (!b) throw new Error(`no branch ${ref}`);
        return { commit: b.sha, paths: [...b.files.keys()] };
      },
      getFile: async (repo, path, ref) => {
        const r = this.repo(repo);
        const content = (r.branches.get(ref ?? r.defaultBranch) ?? [...r.branches.values()].find((b) => b.sha === ref))?.files.get(path);
        if (content === undefined) throw new Error(`no file ${path}`);
        return { content, sha: blobSha(content) };
      },
      putFile: async (repo, o) => {
        const b = this.repo(repo).branches.get(o.branch);
        if (!b) throw new Error(`no branch ${o.branch}`);
        const old = b.files.get(o.path);
        if (o.expectSha !== undefined && (old === undefined ? '' : blobSha(old)) !== o.expectSha) throw new Conflict(`${o.path} changed`);
        this.commit(repo, o.branch, o.path, o.content);
        return { sha: blobSha(o.content) };
      },
      findRelease: async (repo, o) => this.repo(repo).releases.find((r) => r.sha === o.sha || this.repo(repo).contains.get(r.tag)?.includes(o.sha)) ?? null,
      createRelease: async (repo, o) => {
        const r = this.repo(repo);
        if (r.releases.some((x) => x.tag === o.tag)) throw new Error(`tag exists ${o.tag}`);
        const sha = r.tagShas.get(o.tag) ?? o.sha;
        r.tags = r.tags.filter((t) => t !== o.tag);
        return this.addRelease(repo, { ...o, sha, createdAt: r.commitDates.get(sha) });
      },
      listReleases: async (repo) => [...this.repo(repo).releases].reverse(),
      releaseByTag: async (repo, tag) => this.repo(repo).releases.find((r) => r.tag === tag) ?? null,
      isAncestor: async (repo, base, head) => base === head || !!this.repo(repo).ancestors.get(head)?.includes(base),
      updateRelease: async (repo, id, o) => {
        const rel = this.repo(repo).releases.find((r) => r.id === id);
        if (!rel) throw new Error(`no release ${id}`);
        rel.body = o.body;
        return { ...rel };
      },
      latestRelease: async (repo) => this.repo(repo).releases.filter((r) => !r.prerelease).at(-1) ?? null,
      tagSha: async (repo, tag) => this.repo(repo).releases.find((r) => r.tag === tag)?.sha ?? this.repo(repo).tagShas.get(tag) ?? null,
      listTags: async (repo) => [...this.repo(repo).releases.map((r) => r.tag), ...this.repo(repo).tags],
      listCommits: async (repo) => this.repo(repo).commits,
      getCommitDate: async (repo, sha) => this.repo(repo).commitDates.get(sha) ?? new Date(0).toISOString(),
      retargetPullRequest: async (repo, n, base) => {
        const pr = find(repo, n);
        if (pr.state !== 'open') throw new Error(`PR ${n} is ${pr.state}`);
        pr.base = base;
      },
      resetBranch: async (repo, branch, at) => {
        const r = this.repo(repo);
        const files = r.snapshots.get(at);
        if (!files) throw new Error(`no commit ${at}`);
        r.branches.set(branch, { sha: at, files: new Map(files) });
      },
      deleteBranch: async (repo, branch) => {
        this.repo(repo).branches.delete(branch);
      },
      mergeIntoBranch: async (repo, branch, headSha) => {
        const r = this.repo(repo);
        const target = r.branches.get(branch);
        const head = r.snapshots.get(headSha);
        if (!target || !head) throw new Error(`no branch ${branch} or commit ${headSha}`);
        if (r.prs.some((p) => p.headSha === headSha && p.mergeable === false) || [...head].some(([path, c]) => target.files.has(path) && target.files.get(path) !== c)) return { conflict: true };
        if ([...head].every(([path, c]) => target.files.get(path) === c)) return { sha: target.sha };
        for (const [path, c] of head) target.files.set(path, c);
        target.sha = `sha${++this.seq}`;
        r.snapshots.set(target.sha, new Map(target.files));
        return { sha: target.sha };
      },
      queueSupport: async (repo) => this.repo(repo).queueSupport,
      requiredChecks: async (repo) => this.repo(repo).requiredChecks,
      enqueuePullRequest: async (repo, n, o) => {
        const r = this.repo(repo);
        const pr = find(repo, n);
        if (pr.state === 'merged') return { state: 'merged', mergeSha: pr.mergeSha };
        if (pr.state !== 'open') throw new Error(`PR ${n} is ${pr.state}`);
        if (!r.queueSupport) throw new NotQueueableError('the base branch has no merge queue');
        if (pr.mergeable === false) throw new NotQueueableError('the pull request is not mergeable');
        if (o.expectSha !== sha(r, pr.head)) throw new Error(`PR ${n} head moved`);
        if (!r.queue.includes(n)) r.queue.push(n);
        return { state: 'queued' };
      },
      dequeuePullRequest: async (repo, n) => {
        const r = this.repo(repo);
        r.queue = r.queue.filter((x) => x !== n);
      },
      isQueued: async (repo, n) => this.repo(repo).queue.includes(n) && find(repo, n).state === 'open',
      mergePullRequest: async (repo, n, o) => {
        const pr = find(repo, n);
        if (pr.state !== 'open') throw new Error(`PR ${n} is ${pr.state}`);
        if (pr.mergeable === false) throw new Error('merge commit cannot be cleanly created');
        if (o.expectSha && o.expectSha !== sha(this.repo(repo), pr.head)) throw new Error(`PR ${n} head moved`);
        const mergeSha = this.merge(repo, n);
        if (o.deleteBranch && pr.headRepo === pr.baseRepo) {
          for (const s of this.repo(repo).prs) if (s.state === 'open' && s.base === pr.head) s.base = pr.base;
          this.repo(repo).branches.delete(pr.head);
        }
        return { mergeSha };
      },
    };
  }
}

class FakeTickets implements TicketSource {
  private items = new Map<number, FakeTicket>();
  private hidden = new Set<number>();
  constructor(private b: FakeBackend, private repo: RepoRef) {}

  hide(number: number, hidden: boolean): void {
    if (hidden) this.hidden.add(number);
    else this.hidden.delete(number);
  }
  private visible(): FakeTicket[] {
    return [...this.items.values()].filter((t) => !this.hidden.has(t.number));
  }

  private t(id: string): FakeTicket {
    const t = this.items.get(Number(id));
    if (!t || this.hidden.has(t.number)) throw new Error(`no ticket ${id}`);
    return t;
  }
  private record(t: FakeTicket, action: LabelEvent['action'], labels: string[]): void {
    for (const label of labels) t.events.push({ label, action, actor: this.b.actingAs, at: this.b.now() });
  }
  private touch(t: FakeTicket): void {
    t.updatedAt = this.b.now();
  }
  private rel(t: FakeTicket): Relations {
    return this.b.opts.native ? t.rel : parseRelations(t.body).relations;
  }
  private setRel(t: FakeTicket, r: Relations): void {
    if (this.b.opts.native) t.rel = r;
    else {
      t.body = renderRelations(t.body, r);
      this.touch(t);
    }
  }
  private summary(t: FakeTicket): TicketSummary {
    return {
      id: String(t.number), number: t.number, url: `https://fake/${this.repo}/issues/${t.number}`, title: t.title,
      state: t.state, labels: [...t.labels], assignee: t.assignees[0] ?? null, assignees: [...t.assignees], updatedAt: t.updatedAt,
      createdAt: t.createdAt, ...(t.closedAt && { closedAt: t.closedAt }), author: t.author,
      authorTrusted: this.b.isTrusted(t.author), authorIsBot: this.b.isBot(t.author),
    };
  }
  private full(t: FakeTicket): Ticket {
    const r = this.rel(t);
    const closeReason = t.state === 'closed' ? (t.closeReason ?? 'completed') : null;
    const body = parseRelations(t.body).body;
    return { ...this.summary(t), body, parent: r.parent, blockedBy: [...r.blockedBy], links: [...r.links], closeReason };
  }

  async list(opts: ListOptions = {}) {
    const { state = 'open', labels = [] } = opts;
    return this.visible()
      .filter((t) => (state === 'all' || t.state === state) && labels.every((l) => t.labels.includes(l)))
      .map((t) => ({ ...this.summary(t), body: t.body }));
  }
  async get(id: string) {
    return this.full(this.t(id));
  }
  async poll(cursor: string | null) {
    const changes = this.visible()
      .filter((t) => cursor === null || t.updatedAt >= cursor)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .map((t) => this.summary(t));
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }
  async create(n: NewTicket) {
    const number = this.b.nextNumber(this.repo);
    const t: FakeTicket = {
      number, title: n.title, body: n.body ?? '', state: 'open', labels: [...(n.labels ?? [])], assignees: [], author: n.author ?? this.b.opts.user ?? 'fake',
      createdAt: '', updatedAt: '', closeReason: null, rel: { parent: null, blockedBy: [], links: [] },
      comments: [], events: [],
    };
    this.record(t, 'labeled', t.labels);
    this.touch(t);
    t.createdAt = t.updatedAt;
    this.items.set(number, t);
    return this.full(t);
  }
  async comment(id: string, body: string) {
    const t = this.t(id);
    const commentId = `${t.number}-${t.comments.length + 1}`;
    const c: Comment = { id: commentId, author: this.b.actingAs, body, createdAt: '', updatedAt: '' };
    t.comments.push(c);
    this.touch(t);
    c.createdAt = c.updatedAt = t.updatedAt;
    return c;
  }
  async update(id: string, patch: { title?: string; body?: string }) {
    const t = this.t(id);
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.body !== undefined) t.body = this.b.opts.native ? patch.body : renderRelations(patch.body, parseRelations(t.body).relations);
    this.touch(t);
  }
  async updateComment(id: string, commentId: string, body: string) {
    const t = this.t(id);
    const c = t.comments.find((x) => x.id === commentId);
    if (!c) throw new Error(`no comment ${commentId}`);
    c.body = body;
    this.touch(t);
    c.updatedAt = t.updatedAt;
    return c;
  }
  async listComments(id: string, since?: string) {
    return this.t(id).comments.filter((c) => !since || c.updatedAt >= since);
  }
  async addLabels(id: string, labels: string[]) {
    this.b.maybeFail('addLabels');
    const t = this.t(id);
    const added = labels.filter((l) => !t.labels.includes(l));
    t.labels.push(...added);
    this.record(t, 'labeled', added);
    this.touch(t);
  }
  async removeLabels(id: string, labels: string[]) {
    this.b.maybeFail('removeLabels');
    const t = this.t(id);
    this.record(t, 'unlabeled', t.labels.filter((l) => labels.includes(l)));
    t.labels = t.labels.filter((l) => !labels.includes(l));
    this.touch(t);
  }
  async labelEvents(id: string) {
    return [...this.t(id).events];
  }
  async whoami() {
    return this.b.login;
  }
  async claim(id: string, assignee: string) {
    const t = this.t(id);
    if (!(this.b.opts.users ?? [this.b.opts.user ?? 'fake']).includes(assignee)) throw Object.assign(new Error(`claim failed: ${assignee} unknown`), { status: 422 });
    if (!t.assignees.includes(assignee)) t.assignees.push(assignee);
    this.touch(t);
  }
  async release(id: string) {
    const t = this.t(id);
    t.assignees = [];
    this.touch(t);
  }
  async userExists(login: string) {
    return (this.b.opts.users ?? [this.b.opts.user ?? 'fake']).includes(login);
  }
  async unassign(id: string, assignees: string[]) {
    const t = this.t(id);
    t.assignees = t.assignees.filter((a) => !assignees.includes(a));
    this.touch(t);
  }
  async close(id: string, reason: CloseReason) {
    const t = this.t(id);
    t.state = 'closed';
    t.closeReason = reason;
    if (!this.b.opts.native) t.labels.push(closeReasonLabel(reason));
    this.touch(t);
    t.closedAt = t.updatedAt;
  }
  async reopen(id: string) {
    const t = this.t(id);
    t.labels = t.labels.filter((l) => l !== closeReasonLabel(t.closeReason ?? 'completed'));
    t.state = 'open';
    t.closeReason = null;
    delete t.closedAt;
    this.touch(t);
  }
  async addSubTicket(parentId: string, childId: string) {
    this.t(parentId);
    const c = this.t(childId);
    const r = this.rel(c);
    if (r.parent) throw new Error('Sub issue may only have one parent');
    this.setRel(c, { ...r, parent: parentId });
  }
  async listSubTickets(parentId: string) {
    return [...this.items.values()].filter((t) => this.rel(t).parent === parentId).map((t) => this.summary(t));
  }
  async addBlockedBy(id: string, blockerId: string) {
    const t = this.t(id);
    this.t(blockerId);
    const r = this.rel(t);
    if (r.blockedBy.includes(blockerId)) throw new Error('already blocked');
    this.setRel(t, { ...r, blockedBy: [...r.blockedBy, blockerId] });
  }
  async addLink(id: string, url: string) {
    const t = this.t(id);
    const r = this.rel(t);
    this.setRel(t, { ...r, links: [...r.links, url] });
  }
  async frontier(parentId: string) {
    return (await this.listSubTickets(parentId)).filter(
      (s) => s.state === 'open' && this.rel(this.t(s.id)).blockedBy.every((b) => this.t(b).state === 'closed'),
    );
  }
}
