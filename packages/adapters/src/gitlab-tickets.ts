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
import { gitlabAuthorId, secs } from './forge-fields.js';
import type { GitlabApi } from './gitlab-api.js';
import { gitlabNote, gitlabSummary } from './gitlab-mappers.js';
import { closeReasonLabel } from './stage.js';
import { field, get, idText, list, nullableText, num, text, wire } from './wire.js';

const enc = encodeURIComponent;
const REASONS: CloseReason[] = ['completed', 'not_planned', 'duplicate'];

const descriptionOf = (issue: unknown): string => text(wire(issue).description);
const isOpened = (issue: unknown): boolean => wire(issue).state === 'opened';

const labelEvent = (event: unknown): LabelEvent[] => {
  const w = wire(event);
  if (!w.label) return [];
  return [
    {
      label: field(w.label, 'name'),
      action: w.action === 'add' ? 'labeled' : 'unlabeled',
      actor: nullableText(get(w, 'user', 'username')),
      at: secs(text(w.created_at)),
    },
  ];
};

export class GitlabTickets implements TicketSource {
  private p: string;
  constructor(
    private h: GitlabApi,
    private repo: RepoRef,
  ) {
    this.p = `/projects/${enc(repo)}`;
  }
  private async view(i: unknown): Promise<TicketSummary> {
    return { ...gitlabSummary(i), authorTrusted: await this.h.trusted(this.repo, gitlabAuthorId(i)) };
  }
  private issue(id: string) {
    return this.h.json('GET', `${this.p}/issues/${id}`);
  }
  private edit(id: string, body: Record<string, unknown>) {
    return this.h.json('PUT', `${this.p}/issues/${id}`, body);
  }
  private async assigneesOf(id: string): Promise<unknown[]> {
    return list(wire(await this.issue(id)).assignees);
  }
  private async userId(login: string): Promise<number | null> {
    const id = get(list(await this.h.json('GET', `/users?username=${enc(login)}`))[0], 'id');
    return typeof id === 'number' ? id : null;
  }
  private async children(parentId: string): Promise<unknown[]> {
    const q = new URLSearchParams({ search: `Parent: #${parentId}`, in: 'description', state: 'all', per_page: '100' });
    return (await this.h.paginate(`${this.p}/issues?${q}`)).filter(
      (i) => parseRelations(descriptionOf(i)).relations.parent === parentId,
    );
  }

  async list(opts: ListOptions = {}) {
    const q = new URLSearchParams({
      state: { open: 'opened', closed: 'closed', all: 'all' }[opts.state ?? 'open'],
      per_page: '100',
    });
    if (opts.labels?.length) q.set('labels', opts.labels.join(','));
    return Promise.all(
      (await this.h.paginate(`${this.p}/issues?${q}`)).map(async (i) => ({
        ...(await this.view(i)),
        body: descriptionOf(i),
      })),
    );
  }
  async get(id: string): Promise<Ticket> {
    const i = await this.issue(id);
    const { body, relations } = parseRelations(descriptionOf(i));
    const labels = list(wire(i).labels);
    return {
      ...(await this.view(i)),
      body,
      parent: relations.parent,
      blockedBy: relations.blockedBy,
      links: relations.links,
      closeReason: isOpened(i) ? null : (REASONS.find((r) => labels.includes(closeReasonLabel(r))) ?? 'completed'),
    };
  }
  async poll(cursor: string | null) {
    const q = new URLSearchParams({ state: 'all', order_by: 'updated_at', sort: 'asc', per_page: '100' });
    if (cursor !== null) q.set('updated_after', new Date(cursor).toISOString());
    const changes = await Promise.all((await this.h.paginate(`${this.p}/issues?${q}`)).map((i) => this.view(i)));
    return { changes, next: changes.at(-1)?.updatedAt ?? cursor };
  }
  async create(t: NewTicket) {
    const i = await this.h.json('POST', `${this.p}/issues`, {
      title: t.title,
      description: t.body ?? '',
      labels: (t.labels ?? []).join(','),
    });
    return this.get(idText(wire(i).iid));
  }
  async comment(id: string, body: string) {
    return gitlabNote(await this.h.json('POST', `${this.p}/issues/${id}/notes`, { body }));
  }
  async updateComment(id: string, commentId: string, body: string) {
    return gitlabNote(await this.h.json('PUT', `${this.p}/issues/${id}/notes/${commentId}`, { body }));
  }
  async listComments(id: string, since?: string) {
    const notes = (
      await this.h.paginate(`${this.p}/issues/${id}/notes?sort=asc&order_by=created_at&per_page=100`)
    ).filter((n) => !wire(n).system);
    return notes.filter((n) => !since || Date.parse(text(wire(n).updated_at)) >= Date.parse(since)).map(gitlabNote);
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
    const ids = (await this.assigneesOf(id)).map((a) => num(wire(a).id));
    const i = await this.edit(id, { assignee_ids: [...new Set([...ids, uid])] });
    if (!list(wire(i).assignees).some((a) => field(a, 'username').toLowerCase() === assignee.toLowerCase()))
      throw fail();
  }
  async release(id: string) {
    await this.edit(id, { assignee_ids: [] });
  }
  async userExists(login: string) {
    return (await this.userId(login)) !== null;
  }
  async labelEvents(id: string): Promise<LabelEvent[]> {
    return (await this.h.paginate(`${this.p}/issues/${id}/resource_label_events?per_page=100`)).flatMap(labelEvent);
  }
  async whoami() {
    return nullableText(get(await this.h.json('GET', '/user'), 'username'));
  }
  async unassign(id: string, assignees: string[]) {
    if (!assignees.length) return;
    const drop = assignees.map((a) => a.toLowerCase());
    const keep = (await this.assigneesOf(id))
      .filter((a) => !drop.includes(field(a, 'username').toLowerCase()))
      .map((a) => num(wire(a).id));
    await this.edit(id, { assignee_ids: keep });
  }
  async update(id: string, patch: { title?: string; body?: string }) {
    const body: Record<string, unknown> = { ...(patch.title !== undefined && { title: patch.title }) };
    if (patch.body !== undefined)
      body.description = renderRelations(patch.body, parseRelations(descriptionOf(await this.issue(id))).relations);
    await this.edit(id, body);
  }
  async close(id: string, reason: CloseReason) {
    await this.edit(id, { state_event: 'close', add_labels: closeReasonLabel(reason) });
  }
  async reopen(id: string) {
    const closed = !isOpened(await this.issue(id));
    await this.edit(id, {
      ...(closed ? { state_event: 'reopen' } : {}),
      remove_labels: REASONS.map(closeReasonLabel).join(','),
    });
  }
  private async setRelations(id: string, change: (r: ReturnType<typeof parseRelations>['relations']) => void) {
    const description = descriptionOf(await this.issue(id));
    const { relations } = parseRelations(description);
    change(relations);
    await this.edit(id, { description: renderRelations(description, relations) });
  }
  async addSubTicket(parentId: string, childId: string) {
    await this.issue(parentId);
    await this.setRelations(childId, (r) => {
      if (r.parent) throw new Error('Sub issue may only have one parent');
      r.parent = parentId;
    });
  }
  async listSubTickets(parentId: string) {
    return Promise.all((await this.children(parentId)).map((i) => this.view(i)));
  }
  async addBlockedBy(id: string, blockerId: string) {
    await this.issue(blockerId);
    await this.setRelations(id, (r) => {
      if (r.blockedBy.includes(blockerId)) throw new Error('already blocked');
      r.blockedBy.push(blockerId);
    });
  }
  async removeSubTicket(parentId: string, childId: string) {
    await this.setRelations(childId, (r) => {
      if (r.parent === parentId) r.parent = null;
    });
  }
  async removeBlockedBy(id: string, blockerId: string) {
    await this.setRelations(id, (r) => {
      r.blockedBy = r.blockedBy.filter((b) => b !== blockerId);
    });
  }
  async addLink(id: string, url: string) {
    await this.setRelations(id, (r) => void r.links.push(url));
  }
  async frontier(parentId: string) {
    const open = (await this.children(parentId)).filter(isOpened);
    const blocked = await Promise.all(
      open.map(async (i) => {
        const { blockedBy } = parseRelations(descriptionOf(i)).relations;
        return (await Promise.all(blockedBy.map((b) => this.issue(b)))).some(isOpened);
      }),
    );
    return Promise.all(open.filter((_, n) => !blocked[n]).map((i) => this.view(i)));
  }
}
