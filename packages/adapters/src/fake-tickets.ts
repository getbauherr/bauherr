import type {
  Comment,
  CloseReason,
  LabelEvent,
  ListOptions,
  NewTicket,
  RepoRef,
  Ticket,
  TicketSource,
  TicketSummary,
} from './contracts.js';
import { parseRelations, renderRelations, type Relations } from './body-convention.js';
import type { FakeBackend } from './fake.js';
import type { FakeTicket } from './fake-state.js';
import { closeReasonLabel } from './stage.js';

export class FakeTickets implements TicketSource {
  private items = new Map<number, FakeTicket>();
  private hidden = new Set<number>();
  constructor(
    private b: FakeBackend,
    private repo: RepoRef,
  ) {}

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
      id: String(t.number),
      number: t.number,
      url: `https://fake/${this.repo}/issues/${t.number}`,
      title: t.title,
      state: t.state,
      labels: [...t.labels],
      assignee: t.assignees[0] ?? null,
      assignees: [...t.assignees],
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
      ...(t.closedAt && { closedAt: t.closedAt }),
      author: t.author,
      authorTrusted: this.b.isTrusted(t.author),
      authorIsBot: this.b.isBot(t.author),
    };
  }
  private full(t: FakeTicket): Ticket {
    const r = this.rel(t);
    const closeReason = t.state === 'closed' ? (t.closeReason ?? 'completed') : null;
    const body = parseRelations(t.body).body;
    return {
      ...this.summary(t),
      body,
      parent: r.parent,
      blockedBy: [...r.blockedBy],
      links: [...r.links],
      closeReason,
    };
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
      number,
      title: n.title,
      body: n.body ?? '',
      state: 'open',
      labels: [...(n.labels ?? [])],
      assignees: [],
      author: n.author ?? this.b.opts.user ?? 'fake',
      createdAt: '',
      updatedAt: '',
      closeReason: null,
      rel: { parent: null, blockedBy: [], links: [] },
      comments: [],
      events: [],
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
    if (patch.body !== undefined)
      t.body = this.b.opts.native ? patch.body : renderRelations(patch.body, parseRelations(t.body).relations);
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
    this.record(
      t,
      'unlabeled',
      t.labels.filter((l) => labels.includes(l)),
    );
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
    if (!(this.b.opts.users ?? [this.b.opts.user ?? 'fake']).includes(assignee))
      throw Object.assign(new Error(`claim failed: ${assignee} unknown`), { status: 422 });
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
