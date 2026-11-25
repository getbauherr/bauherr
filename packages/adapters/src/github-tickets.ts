import type {
  CloseReason,
  LabelEvent,
  ListOptions,
  NewTicket,
  RepoRef,
  Ticket,
  TicketSource,
  TicketSummary,
} from './contracts.js';
import { parseRelations, renderRelations } from './body-convention.js';
import { githubComment, githubSummary, isGithubIssue } from './github-mappers.js';
import { GithubError } from './github-error.js';
import type { GithubApi } from './github-api.js';
import { field, get, idText, list, nullableText, num, text, wire } from './wire.js';

const sinceParam = (iso: string): string => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
const enc = encodeURIComponent;

const inRepo = (url: string, path: string): boolean => url.toLowerCase().endsWith(path.toLowerCase());

const parentOf = (issue: unknown, path: string): string | null => {
  const url = text(wire(issue).parent_issue_url);
  return url && inRepo(url.replace(/\/issues\/\d+$/, ''), path) ? (url.split('/').at(-1) ?? null) : null;
};

const closeReasonOf = (issue: unknown): CloseReason | null => {
  const w = wire(issue);
  if (w.state !== 'closed') return null;
  return typeof w.state_reason === 'string' ? (w.state_reason as CloseReason) : 'completed';
};

const labelEvent = (event: unknown): LabelEvent[] => {
  const w = wire(event);
  if (!((w.event === 'labeled' || w.event === 'unlabeled') && w.label)) return [];
  return [
    {
      label: field(w.label, 'name'),
      action: w.event,
      actor: nullableText(get(w, 'actor', 'login')),
      at: text(w.created_at),
    },
  ];
};

export class GithubTickets implements TicketSource {
  private p: string;
  constructor(
    private h: GithubApi,
    repo: RepoRef,
  ) {
    this.p = `/repos/${repo}`;
  }
  private issue(id: string) {
    return this.h.json(`GET`, `${this.p}/issues/${id}`);
  }
  private async globalId(id: string): Promise<number> {
    return num(wire(await this.issue(id)).id);
  }
  private blockers(id: string): Promise<unknown[]> {
    return this.h.paginate(`${this.p}/issues/${id}/dependencies/blocked_by?per_page=100`);
  }

  async list(opts: ListOptions = {}) {
    const q = new URLSearchParams({ state: opts.state ?? 'open', per_page: '100' });
    if (opts.labels?.length) q.set('labels', opts.labels.join(','));
    return (await this.h.paginate(`${this.p}/issues?${q}`))
      .filter(isGithubIssue)
      .map((i) => ({ ...githubSummary(i), body: text(wire(i).body) }));
  }
  async get(id: string): Promise<Ticket> {
    const [i, blockers] = await Promise.all([this.issue(id), this.blockers(id)]);
    const { body, relations } = parseRelations(text(wire(i).body));
    const sameRepo = blockers.filter((b) => inRepo(text(wire(b).repository_url), this.p));
    return {
      ...githubSummary(i),
      body,
      parent: parentOf(i, this.p),
      blockedBy: [...new Set([...sameRepo.map((b) => idText(wire(b).number)), ...relations.blockedBy])],
      links: relations.links,
      closeReason: closeReasonOf(i),
    };
  }
  async poll(cursor: string | null) {
    const q = new URLSearchParams({ state: 'all', sort: 'updated', direction: 'asc', per_page: '100' });
    if (cursor !== null) q.set('since', sinceParam(cursor));
    const changes = (await this.h.paginate(`${this.p}/issues?${q}`)).filter(isGithubIssue).map(githubSummary);
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }
  async create(t: NewTicket) {
    const i = await this.h.json('POST', `${this.p}/issues`, {
      title: t.title,
      body: t.body ?? '',
      labels: t.labels ?? [],
    });
    return this.get(idText(wire(i).number));
  }
  async update(id: string, patch: { title?: string; body?: string }) {
    await this.h.json('PATCH', `${this.p}/issues/${id}`, patch);
  }
  async comment(id: string, body: string) {
    return githubComment(await this.h.json('POST', `${this.p}/issues/${id}/comments`, { body }));
  }
  async updateComment(_id: string, commentId: string, body: string) {
    return githubComment(await this.h.json('PATCH', `${this.p}/issues/comments/${commentId}`, { body }));
  }
  async listComments(id: string, since?: string) {
    const q = since ? `&since=${enc(sinceParam(since))}` : '';
    return (await this.h.paginate(`${this.p}/issues/${id}/comments?per_page=100${q}`)).map(githubComment);
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
    if (!list(wire(i).assignees).some((a) => field(a, 'login').toLowerCase() === assignee.toLowerCase()))
      throw Object.assign(new Error(`claim failed: ${assignee} not assigned to #${id}`), { status: 422 });
  }
  async release(id: string) {
    const assignees = list(wire(await this.issue(id)).assignees).map((a) => field(a, 'login'));
    if (assignees.length) await this.h.json('DELETE', `${this.p}/issues/${id}/assignees`, { assignees });
  }
  async userExists(login: string) {
    try {
      await this.h.json('GET', `/users/${encodeURIComponent(login)}`);
      return true;
    } catch (e) {
      if (e instanceof GithubError && e.status === 404) return false;
      throw e;
    }
  }
  async labelEvents(id: string): Promise<LabelEvent[]> {
    return (await this.h.paginate(`${this.p}/issues/${id}/events?per_page=100`)).flatMap(labelEvent);
  }
  async whoami() {
    if (this.h.authKind === 'app') return null;
    return field(await this.h.json('GET', '/user'), 'login');
  }
  async unassign(id: string, assignees: string[]) {
    if (assignees.length) await this.h.json('DELETE', `${this.p}/issues/${id}/assignees`, { assignees });
  }
  async close(id: string, reason: CloseReason) {
    await this.h.json('PATCH', `${this.p}/issues/${id}`, { state: 'closed', state_reason: reason });
  }
  async reopen(id: string) {
    await this.h.json('PATCH', `${this.p}/issues/${id}`, { state: 'open' });
  }
  async addSubTicket(parentId: string, childId: string) {
    await this.h.json('POST', `${this.p}/issues/${parentId}/sub_issues`, {
      sub_issue_id: await this.globalId(childId),
    });
  }
  async listSubTickets(parentId: string): Promise<TicketSummary[]> {
    return (await this.h.paginate(`${this.p}/issues/${parentId}/sub_issues?per_page=100`)).map(githubSummary);
  }
  async addBlockedBy(id: string, blockerId: string) {
    await this.h.json('POST', `${this.p}/issues/${id}/dependencies/blocked_by`, {
      issue_id: await this.globalId(blockerId),
    });
  }
  async removeSubTicket(parentId: string, childId: string) {
    await this.h.json('DELETE', `${this.p}/issues/${parentId}/sub_issue`, {
      sub_issue_id: await this.globalId(childId),
    });
  }
  async removeBlockedBy(id: string, blockerId: string) {
    await this.h.json('DELETE', `${this.p}/issues/${id}/dependencies/blocked_by/${await this.globalId(blockerId)}`);
  }
  async addLink(id: string, url: string) {
    const body = text(wire(await this.issue(id)).body);
    const { relations } = parseRelations(body);
    relations.links.push(url);
    await this.h.json('PATCH', `${this.p}/issues/${id}`, { body: renderRelations(body, relations) });
  }
  async frontier(parentId: string) {
    const open = (await this.listSubTickets(parentId)).filter((s) => s.state === 'open');
    const blocked = await Promise.all(
      open.map(async (s) => (await this.blockers(s.id)).some((b) => wire(b).state === 'open')),
    );
    return open.filter((_, n) => !blocked[n]);
  }
}
