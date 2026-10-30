import { APPROVED_PLAN, setStage } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { DECISIONS_MARKER, WORKLOG_MARKER, latestWith, parseAnswers } from '../app/(app)/lib/plan'
import { connectionInput } from '../jobs'
import { githubFor } from './adapters'

/** Writes shared by the MCP tools and the UI; both call these with the acting Bauherr. */
type Doc = Record<string, any>
type TicketId = number | string

const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const now = () => new Date().toISOString()
const scoped = (user: Doc) => ({ user: user as never, overrideAccess: false, depth: 0 }) as const

export const loadTicket = (payload: Payload, user: Doc, ticket: TicketId): Promise<Doc> =>
  payload.findByID({ collection: 'tickets', id: ticket, ...scoped(user) }) as Promise<Doc>

/** Ticket source for a Ticket's Product, authenticated with the Workspace's github Connection. */
export const sourceOf = async (payload: Payload, ticket: Doc) => {
  const src = (
    await payload.find({ collection: 'ticket_sources', where: { product: { equals: id(ticket.product) } }, limit: 1, depth: 0, overrideAccess: true })
  ).docs[0]
  if (!src) throw new Error('no ticket source for this Product')
  return { ts: githubFor(await connectionInput(payload, src.connection)).tickets(src.repo), n: String(ticket.number) }
}

type Source = Awaited<ReturnType<typeof sourceOf>>

export const worklogComment = async ({ ts, n }: Source) => latestWith(await ts.listComments(n), WORKLOG_MARKER)

export const readWorklog = async (payload: Payload, user: Doc, a: { ticket: TicketId }): Promise<{ workspace: TicketId; markdown: string }> => {
  const t = await loadTicket(payload, user, a.ticket)
  return { workspace: id(t.workspace), markdown: (await worklogComment(await sourceOf(payload, t)))?.body.slice(WORKLOG_MARKER.length).trimStart() ?? '' }
}

export const updateWorklog = async (payload: Payload, user: Doc, a: { ticket: TicketId; markdown: string }) => {
  const t = await loadTicket(payload, user, a.ticket)
  const src = await sourceOf(payload, t)
  const body = `${WORKLOG_MARKER}\n${a.markdown}`
  const existing = await worklogComment(src)
  const saved = existing ? await src.ts.updateComment(src.n, existing.id, body) : await src.ts.comment(src.n, body)
  return { workspace: id(t.workspace), commentId: saved.id, created: !existing }
}

export const requestReview = async (payload: Payload, user: Doc, a: { ticket: TicketId }) => {
  const t = await loadTicket(payload, user, a.ticket)
  const { ts, n } = await sourceOf(payload, t)
  await setStage(ts, n, 'review')
  await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'review' }, overrideAccess: true })
  return { workspace: id(t.workspace), stage: 'review' }
}

/** Plan gate: adds `bauherr:approved:plan` and records the human touch. */
export const approvePlan = async (payload: Payload, user: Doc, a: { ticket: TicketId }) => {
  const t = await loadTicket(payload, user, a.ticket)
  const { ts, n } = await sourceOf(payload, t)
  await ts.addLabels(n, [APPROVED_PLAN])
  await payload.create({
    collection: 'human_touches',
    data: { kind: 'approve:plan', ticket: t.id, workspace: id(t.workspace), actor: user.email, at: now() },
    overrideAccess: true,
  })
  return { workspace: id(t.workspace), approved: APPROVED_PLAN }
}

const WORKLOG_TEMPLATE = `## Worklog
**Goal**
- [ ]

**Current instructions**

**Owners**
| Item / lane | Owner (Run or person) | Paths |

**Unfinished work**
-

**Decisions**

**Affected Tickets**
-`

/** Appends `lines` to the `**Decisions**` section (created at the end when missing). */
const appendDecisions = (worklog: string, lines: string[]): string => {
  const rows = worklog.split('\n')
  const start = rows.findIndex((l) => l.trim() === '**Decisions**')
  if (start < 0) return [...rows, '', '**Decisions**', ...lines].join('\n')
  let end = rows.findIndex((l, i) => i > start && /^\*\*.+\*\*\s*$/.test(l.trim()))
  if (end < 0) end = rows.length
  while (end > start + 1 && !rows[end - 1]!.trim()) end--
  rows.splice(end, 0, ...lines)
  return rows.join('\n')
}

/**
 * Posts the answers as the `<!-- bauherr:decisions -->` Comment (replaced when it exists) and dates every changed
 * answer into the worklog's Decisions.
 */
export const postDecisions = async (
  payload: Payload,
  user: Doc,
  a: { ticket: TicketId; answers: { id: string; title: string; answer: string }[] },
) => {
  const t = await loadTicket(payload, user, a.ticket)
  const src = await sourceOf(payload, t)
  const comments = await src.ts.listComments(src.n)
  const existing = latestWith(comments, DECISIONS_MARKER)
  const previous = existing ? parseAnswers(existing.body) : {}
  const changed = a.answers.filter((x) => previous[x.id] !== x.answer)
  const merged = { ...previous, ...Object.fromEntries(a.answers.map((x) => [x.id, x.answer])) }
  const body = `${DECISIONS_MARKER}\n${Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n')}`
  if (existing) await src.ts.updateComment(src.n, existing.id, body)
  else await src.ts.comment(src.n, body)
  if (changed.length) {
    const date = now().slice(0, 10)
    const lines = changed.map((x) => `- ${date} ${x.id} ${x.title}: ${x.answer}. By: ${user.email}.`)
    const log = latestWith(comments, WORKLOG_MARKER)
    if (log) await src.ts.updateComment(src.n, log.id, appendDecisions(log.body, lines))
    else await src.ts.comment(src.n, `${WORKLOG_MARKER}\n${appendDecisions(WORKLOG_TEMPLATE, lines)}`)
  }
  return { workspace: id(t.workspace), recorded: changed.length }
}
