import { APPROVED_PLAN, setStage } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { DECISIONS_MARKER, PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith, openCritical, parseAnswers } from '../app/(app)/lib/plan'
import { ACTIVE, startRunIfNeeded } from '../jobs'
import { forgeOf, id, publishStagingSummary } from './release'

export const APPROVED_STAGING = 'bauherr:approved:staging'

/** Writes shared by the MCP tools and the UI; both call these with the acting Bauherr. */
type Doc = Record<string, any>
type TicketId = number | string

const now = () => new Date().toISOString()
export const scoped = (user: Doc) => ({ user: user as never, overrideAccess: false, depth: 0 }) as const

export const loadTicket = (payload: Payload, user: Doc, ticket: TicketId): Promise<Doc> =>
  payload.findByID({ collection: 'tickets', id: ticket, ...scoped(user) }) as Promise<Doc>

export const ticketsOf = async (payload: Payload, product: TicketId) => (await forgeOf(payload, product)).tickets

export const sourceOf = async (payload: Payload, ticket: Doc) => ({ ts: await ticketsOf(payload, id(ticket.product)), n: String(ticket.number) })

type Source = Awaited<ReturnType<typeof sourceOf>>

export class NotInWorkspace extends Error {
  constructor() {
    super('ticket not found in this Workspace')
  }
}

/** Loads the Ticket and, when `workspaceId` is given (UI callers), refuses a Ticket of another Workspace. */
const loadIn = async (payload: Payload, user: Doc, ticket: TicketId, workspaceId?: TicketId): Promise<Doc> => {
  const t = await loadTicket(payload, user, ticket)
  if (workspaceId !== undefined && String(id(t.workspace)) !== String(workspaceId)) throw new NotInWorkspace()
  return t
}

export const worklogComment = async ({ ts, n }: Source) => firstWith(await ts.listComments(n), WORKLOG_MARKER)

export const readWorklog = async (payload: Payload, user: Doc, a: { ticket: TicketId }): Promise<string> => {
  const t = await loadTicket(payload, user, a.ticket)
  return (await worklogComment(await sourceOf(payload, t)))?.body.slice(WORKLOG_MARKER.length).trimStart() ?? ''
}

export const updateWorklog = async (payload: Payload, user: Doc, a: { ticket: TicketId; markdown: string }) => {
  const t = await loadTicket(payload, user, a.ticket)
  const src = await sourceOf(payload, t)
  const body = `${WORKLOG_MARKER}\n${a.markdown}`
  const existing = await worklogComment(src)
  const saved = existing ? await src.ts.updateComment(src.n, existing.id, body) : await src.ts.comment(src.n, body)
  return { commentId: saved.id, created: !existing }
}

export const requestReview = async (payload: Payload, user: Doc, a: { ticket: TicketId }) => {
  const t = await loadTicket(payload, user, a.ticket)
  const { ts, n } = await sourceOf(payload, t)
  await setStage(ts, n, 'review')
  await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'review' }, overrideAccess: true })
  return { stage: 'review' }
}

/** Plan gate: refuses while critical decisions are unanswered, then adds `bauherr:approved:plan` and records the human touch. */
export const approvePlan = async (payload: Payload, user: Doc, a: { ticket: TicketId; workspaceId?: TicketId }) => {
  const t = await loadIn(payload, user, a.ticket, a.workspaceId)
  const { ts, n } = await sourceOf(payload, t)
  const open = openCritical(await ts.listComments(n))
  if (open.length) throw new Error(`Answer the critical decisions first: ${open.map((d) => d.id).join(', ')}`)
  await ts.addLabels(n, [APPROVED_PLAN])
  await payload.create({
    collection: 'human_touches',
    data: { kind: 'approve:plan', ticket: t.id, workspace: id(t.workspace), actor: user.email, at: now() },
    overrideAccess: true,
  })
  return { approved: APPROVED_PLAN }
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

const pending = new Map<string, Promise<unknown>>()
/** In-process per-ticket mutex; multi-instance deployments need a DB lock instead. */
const exclusive = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  pending.set(key, next)
  try {
    return await next
  } finally {
    if (pending.get(key) === next) pending.delete(key)
  }
}

/**
 * Posts the answers as the `<!-- bauherr:decisions -->` Comment (replaced when it exists) and dates every changed
 * answer into the worklog's Decisions. Serialised per ticket; the worklog is looked up in comments re-read after the write.
 */
export const postDecisions = async (
  payload: Payload,
  user: Doc,
  a: { ticket: TicketId; workspaceId?: TicketId; answers: { id: string; title: string; answer: string }[] },
) => {
  const t = await loadIn(payload, user, a.ticket, a.workspaceId)
  return exclusive(String(t.id), async () => {
    const src = await sourceOf(payload, t)
    const existing = latestWith(await src.ts.listComments(src.n), DECISIONS_MARKER)
    const previous = existing ? parseAnswers(existing.body) : {}
    const changed = a.answers.filter((x) => previous[x.id] !== x.answer)
    const merged = { ...previous, ...Object.fromEntries(a.answers.map((x) => [x.id, x.answer])) }
    const body = `${DECISIONS_MARKER}\n${Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n')}`
    if (existing) await src.ts.updateComment(src.n, existing.id, body)
    else await src.ts.comment(src.n, body)
    if (changed.length) {
      const date = now().slice(0, 10)
      const lines = changed.map((x) => `- ${date} ${x.id} ${x.title}: ${x.answer}. By: ${user.email}.`)
      const log = firstWith(await src.ts.listComments(src.n), WORKLOG_MARKER)
      if (log) await src.ts.updateComment(src.n, log.id, appendDecisions(log.body, lines))
      else await src.ts.comment(src.n, `${WORKLOG_MARKER}\n${appendDecisions(WORKLOG_TEMPLATE, lines)}`)
    }
    return { recorded: changed.length }
  })
}

export const postStagingSummary = async (payload: Payload, user: Doc, a: { ticket: TicketId; workspaceId?: TicketId }) => {
  const t = await loadIn(payload, user, a.ticket, a.workspaceId)
  if (t.stage !== 'release') throw new Error('the Ticket is not in release')
  return publishStagingSummary(payload, t)
}

const touch = (payload: Payload, user: Doc, t: Doc, kind: string) =>
  payload.create({ collection: 'human_touches', data: { kind, ticket: t.id, workspace: id(t.workspace), actor: user.email, at: now() }, overrideAccess: true })

/** Staging gate: any Admin or Workspace member (the scoped load enforces it) accepts; the Ticket moves to `done` unless the Product has a production gate. */
export const acceptStaging = async (payload: Payload, user: Doc, a: { ticket: TicketId; workspaceId?: TicketId }) => {
  const t = await loadIn(payload, user, a.ticket, a.workspaceId)
  if (t.stage !== 'release') throw new Error('the Ticket is not in release')
  const { tickets: ts } = await forgeOf(payload, id(t.product))
  const n = String(t.number)
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), depth: 0, overrideAccess: true })) as Doc
  const stage = product.productionGate ? 'release' : 'done'
  if (stage === 'done') {
    await setStage(ts, n, 'done')
    await payload.update({ collection: 'tickets', id: t.id, data: { stage }, overrideAccess: true })
  }
  await ts.addLabels(n, [APPROVED_STAGING])
  await touch(payload, user, t, 'accept:staging')
  return { approved: APPROVED_STAGING, stage }
}

/** Writes `text` as the body of the worklog's `**Current instructions**` section (appended when missing). */
const setInstructions = (worklog: string, text: string): string => {
  const rows = worklog.split('\n')
  const start = rows.findIndex((l) => l.trim() === '**Current instructions**')
  if (start < 0) return [...rows, '', '**Current instructions**', text].join('\n')
  let end = rows.findIndex((l, i) => i > start && /^\*\*.+\*\*\s*$/.test(l.trim()))
  if (end < 0) end = rows.length
  rows.splice(start + 1, end - start - 1, text, '')
  return rows.join('\n')
}

/** Sends a released Ticket back: the note becomes the worklog's Current instructions, a Build Run starts, then the stage is `build`. A Ticket already in `build` without an active Run is a retry of a partial failure. */
export const requestChanges = async (payload: Payload, user: Doc, a: { ticket: TicketId; note: string; workspaceId?: TicketId }) => {
  const rawNote = a.note?.trim()
  if (!rawNote) throw new Error('a note is required')
  const t = await loadIn(payload, user, a.ticket, a.workspaceId)
  const active = t.stage === 'build' && (await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { status: { in: ACTIVE } }] }, overrideAccess: true })).totalDocs
  if (t.stage !== 'release' && !(t.stage === 'build' && !active)) throw new Error('the Ticket is not in release')
  const src = await sourceOf(payload, t)
  const note = rawNote.replace(/^(\s*)(\*\*|#)/gm, '$1\\$2')
  const log = await worklogComment(src)
  if (log) await src.ts.updateComment(src.n, log.id, `${WORKLOG_MARKER}\n${setInstructions(log.body.slice(WORKLOG_MARKER.length).trimStart(), note)}`)
  else await src.ts.comment(src.n, `${WORKLOG_MARKER}\n${setInstructions(WORKLOG_TEMPLATE, note)}`)
  const { run } = await startRunIfNeeded(payload, { id: t.id, workspace: t.workspace }, 'build')
  await setStage(src.ts, src.n, 'build')
  await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'build', releaseState: null }, overrideAccess: true })
  await touch(payload, user, t, 'request-changes:staging')
  return { stage: 'build', run: run.id as TicketId }
}
