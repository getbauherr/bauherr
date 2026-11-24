import type {
  Backend,
  Capabilities,
  Check,
  Deployment,
  InlineComment,
  PullRequest,
  Release,
  RepoRef,
  TicketSource,
  Forge,
} from './contracts.js';
import { makeFakeForge } from './fake-forge.js';
import type { FakeRepo } from './fake-state.js';
import { FakeTickets } from './fake-tickets.js';

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
    readonly opts: { native: boolean; user?: string; users?: string[]; trusted?: string[]; bots?: string[] } = {
      native: true,
    },
  ) {
    this.capabilities = {
      attachments: false,
      nativeSubTickets: opts.native,
      nativeBlocking: opts.native,
      webhooks: false,
    };
    this.forge = makeFakeForge(this, {
      repo: (name) => this.repo(name),
      repoNames: () => [...this.repos.keys()],
      nextSeq: () => ++this.seq,
    });
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
    for (const p of this.repo(repo).prs) {
      if (p.head !== branch) continue;
      delete p.mergeable;
      delete p.behind;
      this.touchPr(p);
    }
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

  addRelease(
    repo: RepoRef,
    o: {
      tag: string;
      sha: string;
      body?: string;
      contains?: string[];
      prerelease?: boolean;
      createdAt?: number | string;
    },
  ): Release {
    const r = this.repo(repo);
    if (o.contains) r.contains.set(o.tag, o.contains);
    const rel: Release = {
      id: String(++this.seq),
      tag: o.tag,
      sha: o.sha,
      name: o.tag,
      body: o.body ?? '',
      url: `https://fake/${repo}/releases/tag/${o.tag}`,
      prerelease: !!o.prerelease,
      createdAt: new Date(o.createdAt ?? Date.now()).toISOString(),
    };
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

  setBranchProtected(repo: RepoRef, value: boolean | null): void {
    this.repo(repo).branchProtected = value;
  }

  setDeployment(repo: RepoRef, environment: string, deployment: Deployment | null): void {
    const { deployments } = this.repo(repo);
    if (deployment) deployments.set(environment, deployment);
    else deployments.delete(environment);
  }

  setCommitEndpoint(repo: RepoRef, value: boolean): void {
    this.repo(repo).commitEndpoint = value;
  }

  setCanWrite(repo: RepoRef, value: boolean): void {
    this.repo(repo).canWrite = value;
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
      r = {
        defaultBranch: 'main',
        branches: new Map([['main', { sha: `sha${++this.seq}`, files: new Map() }]]),
        prs: [],
        checks: new Map(),
        rerunChecks: new Map(),
        reruns: [],
        reviews: [],
        resolvedThreads: new Set(),
        commitDates: new Map(),
        releases: [],
        tags: [],
        tagShas: new Map(),
        contains: new Map(),
        commits: [],
        ancestors: new Map(),
        queueSupport: false,
        requiredChecks: [],
        branchProtected: false,
        deployments: new Map(),
        commitEndpoint: false,
        canWrite: true,
        queue: [],
        issued: 0,
        snapshots: new Map(),
      };
      r.snapshots.set(r.branches.get('main')!.sha, new Map());
      this.repos.set(name, r);
    }
    return r;
  }
}
