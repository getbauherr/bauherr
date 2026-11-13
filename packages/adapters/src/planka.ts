import type {
  Backend, Capabilities, CloseReason, Comment, LabelEvent, ListOptions, NewTicket, Ticket, TicketSource, TicketSummary,
} from './contracts.js';
import { parseRelations, renderRelations, type Relations } from './body-convention.js';
import { MAX_WAIT_MS } from './github.js';
import { timedFetch } from './http.js';
import { closeReasonLabel } from './stage.js';

export class PlankaError extends Error {
  constructor(readonly status: number, method: string, path: string, detail: string) {
    super(`Planka ${method} ${path} -> ${status}: ${detail.slice(0, 300)}`);
  }
}

export interface PlankaOptions {
  /** Web origin, e.g. `https://planka.example.com`; the API lives at `<baseUrl>/api`. */
  baseUrl: string;
  /** API key or access token, sent as a Bearer token. */
  token: string;
  /** The watched board; every card on it is a Ticket. */
  boardId: string;
  /** Stage name -> list name: adding `bauherr:stage:<stage>` moves the card to that list. */
  lists?: Record<string, string>;
  /** List that holds closed cards (default `Done`). */
  closedList?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

/** Minimal REST client: Bearer token, backoff on 429 honouring Retry-After. Errors never carry the token. */
export class PlankaHttp {
  private base: string;
  private doFetch: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;
  constructor(private o: PlankaOptions) {
    this.base = `${o.baseUrl.replace(/\/+$/, '')}/api`;
    this.doFetch = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 3;
  }

  async json<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await timedFetch(this.doFetch, this.base + path, {
        cache: 'no-store',
        method,
        headers: {
          authorization: `Bearer ${this.o.token}`,
          accept: 'application/json',
          'user-agent': 'bauherr',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, this.o.timeoutMs);
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Number(res.headers.get('retry-after') ?? 60) * 1000;
        if (wait > MAX_WAIT_MS) throw new PlankaError(429, method, path, `rate limited for ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) throw new PlankaError(res.status, method, path, await res.text());
      return (res.status === 204 ? undefined : await res.json()) as T;
    }
  }
}

const enc = encodeURIComponent;
const secs = (iso: string): string => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const STAGE_PREFIX = 'bauherr:stage:';
const REASONS: CloseReason[] = ['completed', 'not_planned', 'duplicate'];
const CLOSED_TYPES = ['closed', 'archive', 'trash'];
const MAX_EVENTS = 200;

interface Board { lists: any[]; cards: any[]; labels: any[]; cardLabels: any[]; cardMemberships: any[]; users: any[] }
interface Meta { number: number | null; events: LabelEvent[] }
interface Parsed { body: string; meta: Meta; relations: Relations }

const META = /\n*<!-- bauherr:planka -->([\s\S]*?)<!-- \/bauherr:planka -->\s*$/;

/** Description layout: user body, `bauherr:planka` block (number, label log), then the shared relations block. */
function parseDesc(desc: string | null | undefined): Parsed {
  const { body: rest, relations } = parseRelations(desc ?? '');
  const m = META.exec(rest);
  const meta: Meta = { number: null, events: [] };
  if (!m) return { body: rest, meta, relations };
  for (const line of (m[1] ?? '').split('\n')) {
    const n = /^Number:\s*(\d+)\s*$/.exec(line);
    if (n) meta.number = Number(n[1]);
    const e = /^Label:\s*(labeled|unlabeled)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
    if (e) meta.events.push({ action: e[1] as LabelEvent['action'], label: decodeURIComponent(e[2]!), actor: e[3] === '-' ? null : decodeURIComponent(e[3]!), at: e[4]! });
  }
  return { body: rest.slice(0, m.index), meta, relations };
}

function renderDesc(p: Parsed): string {
  const lines = [
    `Number: ${p.meta.number}`,
    ...p.meta.events.slice(-MAX_EVENTS).map((e) => `Label: ${e.action} ${enc(e.label)} ${e.actor ? enc(e.actor) : '-'} ${e.at}`),
  ];
  return renderRelations(`${p.body}\n\n<!-- bauherr:planka -->\n${lines.join('\n')}\n<!-- /bauherr:planka -->`, p.relations);
}

const numberOf = (c: any): number | null => parseDesc(c.description).meta.number;
const listOf = (b: Board, c: any) => b.lists.find((l) => l.id === c.listId);
const labelsOf = (b: Board, c: any): string[] => b.cardLabels
  .filter((cl) => cl.cardId === c.id)
  .map((cl) => b.labels.find((l) => l.id === cl.labelId)?.name)
  .filter((n): n is string => !!n);
const membersOf = (b: Board, c: any): any[] => b.cardMemberships
  .filter((m) => m.cardId === c.id)
  .map((m) => b.users.find((u) => u.id === m.userId))
  .filter(Boolean);
const isClosed = (b: Board, c: any, closedList: string): boolean => {
  const l = listOf(b, c);
  return l?.name === closedList || CLOSED_TYPES.includes(l?.type) || c.isClosed === true;
};

export class PlankaTicketSource implements TicketSource {
  readonly capabilities: Capabilities = { attachments: false, nativeSubTickets: false, nativeBlocking: false, webhooks: false };
  private h: PlankaHttp;
  private closedList: string;
  private chain: Promise<void> = Promise.resolve();
  private me: Promise<string | null> | undefined;
  constructor(private o: PlankaOptions) {
    this.h = new PlankaHttp(o);
    this.closedList = o.closedList ?? 'Done';
  }

  /** Runs `fn` after every earlier write of this instance: number allocation, label creation and description edits cannot interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.then(() => {}, () => {});
    return run;
  }

  private async board(): Promise<Board> {
    const { included: i } = await this.h.json('GET', `/boards/${this.o.boardId}`);
    return {
      lists: i.lists ?? [], cards: i.cards ?? [], labels: i.labels ?? [],
      cardLabels: i.cardLabels ?? [], cardMemberships: i.cardMemberships ?? [], users: i.users ?? [],
    };
  }

  private nextNumber(b: Board): number {
    return Math.max(0, ...b.cards.map((c) => numberOf(c) ?? 0)) + 1;
  }

  /** Gives every card without a number the next one (oldest first). Call inside `serial` on a fresh board. */
  private async assignNumbers(b: Board): Promise<Board> {
    const missing = b.cards.filter((c) => numberOf(c) === null).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)) || x.id.localeCompare(y.id));
    for (const c of missing) {
      const p = parseDesc(c.description);
      p.meta.number = this.nextNumber(b);
      Object.assign(c, (await this.h.json('PATCH', `/cards/${c.id}`, { description: renderDesc(p) })).item);
    }
    return b;
  }

  private fresh(): Promise<Board> {
    return this.board().then((b) => this.assignNumbers(b));
  }

  /** The board with every card numbered; the write path is only taken when a card lacks one. */
  private async numbered(): Promise<Board> {
    const b = await this.board();
    return b.cards.every((c) => numberOf(c) !== null) ? b : this.serial(() => this.fresh());
  }

  private locate(b: Board, id: string): any {
    const c = b.cards.find((x) => String(numberOf(x)) === id);
    if (!c) throw new PlankaError(404, 'GET', `/boards/${this.o.boardId}`, `no card with ticket number ${id}`);
    return c;
  }

  private async find(id: string): Promise<{ b: Board; c: any }> {
    const b = await this.numbered();
    return { b, c: this.locate(b, id) };
  }

  private summary(b: Board, c: any): TicketSummary {
    const members = membersOf(b, c).map((u) => u.username as string);
    return {
      id: String(numberOf(c)), number: numberOf(c)!, url: `${this.o.baseUrl.replace(/\/+$/, '')}/cards/${c.id}`, title: c.name,
      state: isClosed(b, c, this.closedList) ? 'closed' : 'open', labels: labelsOf(b, c),
      assignee: members[0] ?? null, assignees: members, updatedAt: secs(c.updatedAt ?? c.createdAt),
    };
  }

  private ticket(b: Board, c: any): Ticket {
    const { body, relations } = parseDesc(c.description);
    const s = this.summary(b, c);
    return {
      ...s, body, parent: relations.parent, blockedBy: relations.blockedBy, links: relations.links,
      closeReason: s.state === 'closed' ? (REASONS.find((r) => s.labels.includes(closeReasonLabel(r))) ?? 'completed') : null,
      author: b.users.find((u) => u.id === (c.creatorUserId ?? c.userId))?.username ?? null,
    };
  }

  private actor(): Promise<string | null> {
    return (this.me ??= this.whoami().catch(() => null));
  }

  private firstList(b: Board): any {
    const l = [...b.lists].sort((x, y) => (x.position ?? 0) - (y.position ?? 0)).find((x) => x.name !== this.closedList && !CLOSED_TYPES.includes(x.type));
    if (!l) throw new Error(`Planka board ${this.o.boardId} has no open list`);
    return l;
  }

  private namedList(b: Board, name: string): any {
    const l = b.lists.find((x) => x.name === name);
    if (!l) throw new Error(`Planka board ${this.o.boardId} has no list "${name}"`);
    return l;
  }

  /** The list a stage label maps to, when `lists` maps it. */
  private stageList(b: Board, labels: string[]): any | undefined {
    const stage = labels.filter((l) => l.startsWith(STAGE_PREFIX)).map((l) => l.slice(STAGE_PREFIX.length)).findLast((s) => this.o.lists?.[s]);
    return stage === undefined ? undefined : this.namedList(b, this.o.lists![stage]!);
  }

  private async moveTo(c: any, listId: string): Promise<void> {
    if (c.listId !== listId) await this.h.json('PATCH', `/cards/${c.id}`, { listId, position: 65535 });
  }

  async list(opts: ListOptions = {}) {
    const b = await this.numbered();
    const state = opts.state ?? 'open';
    return b.cards
      .map((c) => ({ ...this.summary(b, c), body: parseDesc(c.description).body }))
      .filter((t) => (state === 'all' || t.state === state) && (opts.labels ?? []).every((l) => t.labels.includes(l)))
      .sort((x, y) => x.number - y.number);
  }

  async get(id: string): Promise<Ticket> {
    const { b, c } = await this.find(id);
    return this.ticket(b, c);
  }

  async poll(cursor: string | null) {
    const b = await this.numbered();
    const since = cursor === null ? null : secs(cursor);
    const changes = b.cards.map((c) => this.summary(b, c))
      .filter((t) => since === null || t.updatedAt >= since)
      .sort((x, y) => x.updatedAt.localeCompare(y.updatedAt) || x.number - y.number);
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }

  async create(t: NewTicket) {
    const n = await this.serial(async () => {
      const b = await this.fresh();
      const number = this.nextNumber(b);
      const list = this.stageList(b, t.labels ?? []) ?? this.firstList(b);
      const body = renderDesc({ body: t.body ?? '', meta: { number, events: [] }, relations: { parent: null, blockedBy: [], links: [] } });
      await this.h.json('POST', `/lists/${list.id}/cards`, { name: t.title, type: 'project', description: body, position: 65535 });
      return number;
    });
    if (t.labels?.length) await this.addLabels(String(n), t.labels);
    return this.get(String(n));
  }

  async update(id: string, patch: { title?: string; body?: string }) {
    await this.edit(id, (p) => void (patch.body !== undefined && (p.body = parseRelations(patch.body).body)), patch.title);
  }

  /** Read-modify-write of the description under the lock, optionally with a new title. */
  private edit(id: string, change: (p: Parsed) => void, name?: string): Promise<void> {
    return this.serial(async () => {
      const c = this.locate(await this.fresh(), id);
      const p = parseDesc(c.description);
      change(p);
      await this.h.json('PATCH', `/cards/${c.id}`, { ...(name !== undefined && { name }), description: renderDesc(p) });
    });
  }

  private commentOf(c: any, users: any[]): Comment {
    return { id: String(c.id), author: users.find((u) => u.id === c.userId)?.username ?? '', body: c.text ?? '', createdAt: secs(c.createdAt) };
  }

  async comment(id: string, body: string) {
    const { c } = await this.find(id);
    const { item } = await this.h.json('POST', `/cards/${c.id}/comments`, { text: body });
    return { ...this.commentOf(item, []), author: (await this.actor()) ?? '' };
  }

  async updateComment(_id: string, commentId: string, body: string) {
    const { item } = await this.h.json('PATCH', `/comments/${enc(commentId)}`, { text: body });
    return { ...this.commentOf(item, []), author: (await this.actor()) ?? '' };
  }

  async listComments(id: string, since?: string) {
    const { c } = await this.find(id);
    const { items, included } = await this.h.json('GET', `/cards/${c.id}/comments`);
    return (items as any[])
      .filter((x) => !since || Date.parse(x.updatedAt ?? x.createdAt) >= Date.parse(since))
      .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)))
      .map((x) => this.commentOf(x, included?.users ?? []));
  }

  async addLabels(id: string, labels: string[]) {
    await this.changeLabels(id, labels, 'labeled');
  }

  async removeLabels(id: string, labels: string[]) {
    await this.changeLabels(id, labels, 'unlabeled');
  }

  /** Adds or removes card labels (board labels are created on demand), logs the change in the footer, and moves the card for a mapped stage label. */
  private changeLabels(id: string, labels: string[], action: LabelEvent['action']): Promise<void> {
    return this.serial(async () => {
      const b = await this.fresh();
      const c = this.locate(b, id);
      const have = labelsOf(b, c);
      const todo = [...new Set(labels)].filter((l) => have.includes(l) === (action === 'unlabeled'));
      if (!todo.length) return;
      const list = action === 'labeled' ? this.stageList(b, todo) : undefined;
      const actor = await this.actor();
      for (const name of todo) {
        let label = b.labels.find((l) => l.name === name);
        if (action === 'labeled') {
          label ??= (await this.h.json('POST', `/boards/${this.o.boardId}/labels`, { name, color: 'berry-purple', position: 65535 })).item;
          await this.h.json('POST', `/cards/${c.id}/card-labels`, { labelId: label.id });
        } else {
          await this.h.json('DELETE', `/cards/${c.id}/card-labels/labelId:${label.id}`);
        }
      }
      const p = parseDesc(c.description);
      const at = secs(new Date().toISOString());
      p.meta.events.push(...todo.map((label) => ({ label, action, actor, at })));
      await this.h.json('PATCH', `/cards/${c.id}`, { description: renderDesc(p), ...(list && list.id !== c.listId && { listId: list.id, position: 65535 }) });
    });
  }

  async labelEvents(id: string): Promise<LabelEvent[]> {
    const { c } = await this.find(id);
    return parseDesc(c.description).meta.events;
  }

  async whoami() {
    const { item } = await this.h.json('GET', '/users/me');
    const login = item?.username ?? item?.name;
    if (!login) throw new Error('Planka /users/me returned no username');
    return login as string;
  }

  async claim(id: string, assignee: string) {
    const { b, c } = await this.find(id);
    const user = b.users.find((u) => u.username?.toLowerCase() === assignee.toLowerCase());
    if (!user) throw Object.assign(new Error(`claim failed: ${assignee} is not a member of the board, so not assigned to #${id}`), { status: 422 });
    if (!membersOf(b, c).some((u) => u.id === user.id)) await this.h.json('POST', `/cards/${c.id}/card-memberships`, { userId: user.id });
  }

  async release(id: string) {
    const { b, c } = await this.find(id);
    await this.dropMembers(c, membersOf(b, c));
  }

  async unassign(id: string, assignees: string[]) {
    const drop = assignees.map((a) => a.toLowerCase());
    const { b, c } = await this.find(id);
    await this.dropMembers(c, membersOf(b, c).filter((u) => drop.includes(u.username?.toLowerCase())));
  }

  private async dropMembers(c: any, users: any[]) {
    for (const u of users) await this.h.json('DELETE', `/cards/${c.id}/card-memberships/userId:${u.id}`);
  }

  /** Whether the login is a user of the watched board (only those can be card members). */
  async userExists(login: string) {
    return (await this.board()).users.some((u) => u.username?.toLowerCase() === login.toLowerCase());
  }

  async close(id: string, reason: CloseReason) {
    await this.removeLabels(id, REASONS.filter((r) => r !== reason).map(closeReasonLabel));
    await this.addLabels(id, [closeReasonLabel(reason)]);
    const { b, c } = await this.find(id);
    await this.moveTo(c, this.namedList(b, this.closedList).id);
  }

  async reopen(id: string) {
    const { b, c } = await this.find(id);
    if (isClosed(b, c, this.closedList)) await this.moveTo(c, (this.stageList(b, labelsOf(b, c)) ?? this.firstList(b)).id);
    await this.removeLabels(id, REASONS.map(closeReasonLabel));
  }

  async addSubTicket(parentId: string, childId: string) {
    await this.get(parentId);
    await this.edit(childId, (p) => {
      if (p.relations.parent) throw new Error('Sub ticket may only have one parent');
      p.relations.parent = parentId;
    });
  }

  async listSubTickets(parentId: string) {
    const b = await this.numbered();
    return this.children(b, parentId).map((c) => this.summary(b, c));
  }

  private children(b: Board, parentId: string): any[] {
    return b.cards.filter((c) => parseDesc(c.description).relations.parent === parentId);
  }

  async addBlockedBy(id: string, blockerId: string) {
    await this.get(blockerId);
    await this.edit(id, (p) => {
      if (p.relations.blockedBy.includes(blockerId)) throw new Error('already blocked');
      p.relations.blockedBy.push(blockerId);
    });
  }

  async addLink(id: string, url: string) {
    await this.edit(id, (p) => void p.relations.links.push(url));
  }

  async frontier(parentId: string) {
    const b = await this.numbered();
    return this.children(b, parentId)
      .filter((c) => !isClosed(b, c, this.closedList))
      .filter((c) => parseDesc(c.description).relations.blockedBy.every((n) => isClosed(b, this.locate(b, n), this.closedList)))
      .map((c) => this.summary(b, c));
  }
}

/** Planka hosts no code: pairs a code `Backend` (GitHub/GitLab) with Planka as its ticket source. */
export function withTickets(backend: Backend, source: TicketSource): Backend {
  return { ...backend, capabilities: { ...backend.capabilities, nativeSubTickets: false, nativeBlocking: false }, tickets: () => source };
}
