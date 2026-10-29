import type {
  Backend, Branch, Capabilities, Check, CloseReason, Comment, Forge, ListOptions, NewPullRequest, NewTicket,
  PullRequest, PullRequestFile, RepoRef, Repository, Ticket, TicketSource, TicketSummary,
} from './contracts.js';
import { parseRelations, renderRelations, type Relations } from './body-convention.js';
import { closeReasonLabel } from './stage.js';

interface FakeTicket {
  number: number; title: string; body: string; state: 'open' | 'closed'; labels: string[];
  assignee: string | null; updatedAt: string; closeReason: CloseReason | null; rel: Relations; comments: Comment[];
}
interface FakeRepo {
  defaultBranch: string;
  branches: Map<string, { sha: string; files: Map<string, string> }>;
  prs: PullRequest[];
}

/** In-memory Backend. `native` = relations as fields; otherwise body convention + close-reason labels. */
export class FakeBackend implements Backend {
  readonly capabilities: Capabilities;
  readonly forge: Forge;
  private ticketSources = new Map<string, FakeTickets>();
  private repos = new Map<string, FakeRepo>();
  private tick = 0;
  private seq = 0;

  constructor(readonly opts: { native: boolean; user?: string; users?: string[] } = { native: true }) {
    this.capabilities = {
      attachments: false, nativeSubTickets: opts.native, nativeBlocking: opts.native, webhooks: false,
    };
    this.forge = this.makeForge();
  }

  now(): string {
    return new Date(Date.UTC(2026, 0, 1) + ++this.tick * 1000).toISOString().replace('.000Z', 'Z');
  }

  tickets(repo: RepoRef): TicketSource {
    let ts = this.ticketSources.get(repo);
    if (!ts) this.ticketSources.set(repo, (ts = new FakeTickets(this, repo)));
    return ts;
  }

  /** Test helper: writes a file on a branch (creates the repo with branch `main` if unknown). */
  commit(repo: RepoRef, branch: string, path: string, content: string): void {
    const b = this.repo(repo).branches.get(branch);
    if (!b) throw new Error(`no branch ${branch}`);
    b.files.set(path, content);
    b.sha = `sha${++this.seq}`;
  }

  private repo(name: RepoRef): FakeRepo {
    let r = this.repos.get(name);
    if (!r) {
      r = { defaultBranch: 'main', branches: new Map([['main', { sha: `sha${++this.seq}`, files: new Map() }]]), prs: [] };
      this.repos.set(name, r);
    }
    return r;
  }

  private makeForge(): Forge {
    const sha = (r: FakeRepo, b: string) => r.branches.get(b)?.sha ?? '';
    const find = (repo: RepoRef, n: number) => {
      const pr = this.repo(repo).prs.find((p) => p.number === n);
      if (!pr) throw new Error(`no PR ${n}`);
      return pr;
    };
    const comments = new Map<string, Comment[]>();
    const view = (repo: RepoRef, name: string): Repository => ({
      fullName: name, defaultBranch: this.repo(repo).defaultBranch, private: true, url: `https://fake/${name}`,
    });
    return {
      listRepositories: async () => [...this.repos.keys()].map((n) => view(n, n)),
      getRepository: async (repo) => view(repo, repo),
      listBranches: async (repo) => [...this.repo(repo).branches].map(([name, b]): Branch => ({ name, sha: b.sha })),
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
        const created: PullRequest = {
          number: r.prs.length + 1, url: `https://fake/${repo}/pull/${r.prs.length + 1}`, title: pr.title,
          body: pr.body ?? '', state: 'open', head: pr.head, base: pr.base, headSha: sha(r, pr.head),
        };
        r.prs.push(created);
        return created;
      },
      getPullRequest: async (repo, n) => find(repo, n),
      listPullRequests: async (repo, state = 'open') =>
        this.repo(repo).prs.filter((p) => state === 'all' || (state === 'open') === (p.state === 'open')),
      commentOnPullRequest: async (repo, n, body) => {
        find(repo, n);
        const c: Comment = { id: String(++this.seq), author: this.opts.user ?? 'fake', body, createdAt: this.now() };
        comments.set(`${repo}#${n}`, [...(comments.get(`${repo}#${n}`) ?? []), c]);
        return c;
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
      listChecks: async (): Promise<Check[]> => [],
    };
  }
}

class FakeTickets implements TicketSource {
  private items = new Map<number, FakeTicket>();
  constructor(private b: FakeBackend, private repo: RepoRef) {}

  private t(id: string): FakeTicket {
    const t = this.items.get(Number(id));
    if (!t) throw new Error(`no ticket ${id}`);
    return t;
  }
  private touch(t: FakeTicket): void {
    t.updatedAt = this.b.now();
  }
  /** Relations live in fields (native) or in the stored body (convention). */
  private rel(t: FakeTicket): Relations {
    return this.b.opts.native ? t.rel : parseRelations(t.body).relations;
  }
  private setRel(t: FakeTicket, r: Relations): void {
    if (this.b.opts.native) t.rel = r;
    else {
      t.body = renderRelations(t.body, r);
      this.touch(t); // convention writes edit the body, which bumps updatedAt
    }
  }
  private summary(t: FakeTicket): TicketSummary {
    return {
      id: String(t.number), number: t.number, url: `https://fake/${this.repo}/issues/${t.number}`, title: t.title,
      state: t.state, labels: [...t.labels], assignee: t.assignee, updatedAt: t.updatedAt,
    };
  }
  private full(t: FakeTicket): Ticket {
    const r = this.rel(t);
    const closeReason = t.state === 'closed' ? (t.closeReason ?? 'completed') : null;
    return { ...this.summary(t), body: parseRelations(t.body).body, parent: r.parent, blockedBy: [...r.blockedBy], links: [...r.links], closeReason };
  }

  async list(opts: ListOptions = {}) {
    const { state = 'open', labels = [] } = opts;
    return [...this.items.values()]
      .filter((t) => (state === 'all' || t.state === state) && labels.every((l) => t.labels.includes(l)))
      .map((t) => this.summary(t));
  }
  async get(id: string) {
    return this.full(this.t(id));
  }
  async poll(cursor: string | null) {
    const changes = [...this.items.values()]
      .filter((t) => cursor === null || t.updatedAt >= cursor)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .map((t) => this.summary(t));
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }
  async create(n: NewTicket) {
    const number = this.items.size + 1;
    const t: FakeTicket = {
      number, title: n.title, body: n.body ?? '', state: 'open', labels: [...(n.labels ?? [])], assignee: null,
      updatedAt: '', closeReason: null, rel: { parent: null, blockedBy: [], links: [] }, comments: [],
    };
    this.touch(t);
    this.items.set(number, t);
    return this.full(t);
  }
  async comment(id: string, body: string) {
    const t = this.t(id);
    const c: Comment = { id: `${t.number}-${t.comments.length + 1}`, author: this.b.opts.user ?? 'fake', body, createdAt: this.b.now() };
    t.comments.push(c);
    this.touch(t);
    return c;
  }
  async listComments(id: string, since?: string) {
    return this.t(id).comments.filter((c) => !since || c.createdAt >= since);
  }
  async addLabels(id: string, labels: string[]) {
    const t = this.t(id);
    for (const l of labels) if (!t.labels.includes(l)) t.labels.push(l);
    this.touch(t);
  }
  async removeLabels(id: string, labels: string[]) {
    const t = this.t(id);
    t.labels = t.labels.filter((l) => !labels.includes(l));
    this.touch(t);
  }
  async claim(id: string, assignee: string) {
    const t = this.t(id);
    if (!(this.b.opts.users ?? [this.b.opts.user ?? 'fake']).includes(assignee)) throw new Error(`claim failed: ${assignee} unknown`);
    t.assignee = assignee;
    this.touch(t);
  }
  async release(id: string) {
    const t = this.t(id);
    t.assignee = null;
    this.touch(t);
  }
  async close(id: string, reason: CloseReason) {
    const t = this.t(id);
    t.state = 'closed';
    t.closeReason = reason;
    if (!this.b.opts.native) t.labels.push(closeReasonLabel(reason));
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
