import { APPROVED_PLAN, setStage } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { DECISIONS_MARKER, PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith, openCritical, parseAnswers } from '../app/(app)/lib/plan'
import { ACTIVE, RELEASED_BY, abandonRun, startReviewIfReady, startRunIfNeeded } from '../jobs'
import { forgeOf, id, isFactoryPr, mergeChecks, prOf, publishStagingSummary } from './release'

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

export class NotReleasable extends Error {
  constructor(runId: TicketId) {
    super(`run ${runId} is not a running session Run`)
  }
}

/** Workspace ids of a Bauherr's tenants. */
export const tenantsOf = (user: Doc): TicketId[] => ((user.tenants as { tenant: unknown }[]) ?? []).map((t) => id(t.tenant))

/** Human force-release of a leased session Run (Admin or a member of its Workspace): ends it `abandoned`, queues the successor, records a human touch. Never escalates to needs_human. */
export const releaseLock = async (payload: Payload, user: Doc, a: { runId: TicketId }) => {
  const run = (await payload.findByID({ collection: 'runs', id: a.runId, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  if (!run || (user.role !== 'admin' && !tenantsOf(user).some((w) => String(w) === String(id(run.workspace))))) throw new NotInWorkspace()
  if (run.mode !== 'session' || run.status !== 'running' || (await abandonRun(payload, run, { reason: `${RELEASED_BY}${user.email}`, escalate: false })) === null) throw new NotReleasable(run.id)
  await payload.create({
    collection: 'human_touches',
    data: { kind: `release-lock:${run.stage}`, ticket: id(run.ticket), run: run.id, workspace: id(run.workspace), actor: user.email, at: now() },
    overrideAccess: true,
  })
  return { status: 'abandoned' }
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

/** Posts or updates the Ticket's single plan Comment (`<!-- bauherr:plan -->`). */
export const submitPlan = async (payload: Payload, user: Doc, a: { ticket: TicketId; markdown: string }) => {
  const { ts, n } = await sourceOf(payload, await loadTicket(payload, user, a.ticket))
  const body = `${PLAN_MARKER}\n${a.markdown.replace(PLAN_MARKER, '').trim()}`
  const existing = latestWith(await ts.listComments(n), PLAN_MARKER)
  const saved = existing ? await ts.updateComment(n, existing.id, body) : await ts.comment(n, body)
  return { commentId: saved.id, created: !existing }
}

export const requestReview = async (payload: Payload, user: Doc, a: { ticket: TicketId }) => {
  const t = await loadTicket(payload, user, a.ticket)
  const { ts, n } = await sourceOf(payload, t)
  await setStage(ts, n, 'review')
  await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'review' }, overrideAccess: true })
  await startReviewIfReady(payload, { ...t, stage: 'review' })
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
  if (stage === 'done') {
    await ts.close(n, 'completed')
    await payload.update({ collection: 'tickets', id: t.id, data: { state: 'closed' }, overrideAccess: true })
  }
  return { approved: APPROVED_STAGING, stage }
}

/** Writes `text` as the body of the worklog section headed `heading` (appended when missing). */
const setSection = (worklog: string, heading: string, text: string): string => {
  const rows = worklog.split('\n')
  const start = rows.findIndex((l) => l.trim() === heading)
  if (start < 0) return [...rows, '', heading, text].join('\n')
  let end = rows.findIndex((l, i) => i > start && /^\*\*.+\*\*\s*$/.test(l.trim()))
  if (end < 0) end = rows.length
  rows.splice(start + 1, end - start - 1, text, '')
  return rows.join('\n')
}
const setInstructions = (worklog: string, text: string): string => setSection(worklog, '**Current instructions**', text)

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

export const REVIEW_MARKER = '<!-- bauherr:review -->'
/** Returns from review to build per Ticket before it needs a human. */
export const MAX_REVIEW_ROUNDS = 2
/** A Ticket waiting on checks (or a draft MR) this long needs a human. */
export const WAIT_CHECKS_MAX_MS = 2 * 60 * 60_000
/** Consecutive failed merge attempts before a Ticket needs a human. */
export const MAX_MERGE_FAILURES = 3
const BLOCKING = ['high', 'medium']
export const MAX_FINDINGS = 50
export const MAX_TEXT = 1000
/** Fits GitHub's 65536-character comment limit with the marker. */
export const MAX_MARKDOWN = 60_000
const FILE = /^[\w./@+-]{1,300}$/
/** Areas a review must account for, each with a one-line justification. */
export const CHECKED_AREAS = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence']

export type Finding = { severity: 'high' | 'medium' | 'low'; file: string; line: number; msg: string; scenario: string }
/** `problem` is set when the output cannot be trusted as a verdict (incomplete checklist, contradictory verdict): the Ticket goes to a human, never to a merge. */
export type Review = { verdict: 'clean' | 'changes'; findings: Finding[]; markdown: string; problem?: string }
export type ReviewOutcome = 'merged' | 'waiting_checks' | 'ready_for_human' | 'build' | 'needs_human' | 'review_restarted' | 'noop'

/** Validates a reviewer's output. The verdict is derived: `changes` iff a high or medium finding exists. */
export const normalizeReview = (raw: any): Review => {
  if (!raw || !['clean', 'changes'].includes(raw.verdict) || !Array.isArray(raw.findings) || typeof raw.markdown !== 'string' || !raw.markdown.trim()) {
    throw new Error('a review needs verdict (clean|changes), findings[] and markdown')
  }
  if (raw.findings.length > MAX_FINDINGS) throw new Error(`at most ${MAX_FINDINGS} findings`)
  if (raw.markdown.length > MAX_MARKDOWN) throw new Error(`markdown is limited to ${MAX_MARKDOWN} characters`)
  const findings = raw.findings.map((f: any, i: number): Finding => {
    if (
      !f || !BLOCKING.concat('low').includes(f.severity) || typeof f.file !== 'string' || !FILE.test(f.file) || !Number.isInteger(f.line) || f.line < 0 ||
      typeof f.msg !== 'string' || f.msg.length > MAX_TEXT || typeof f.scenario !== 'string' || f.scenario.length > MAX_TEXT
    ) {
      throw new Error(`finding ${i} needs severity (high|medium|low), file (path characters, max 300), line (integer >= 0), msg and scenario (max ${MAX_TEXT} characters)`)
    }
    return { severity: f.severity, file: f.file, line: f.line, msg: f.msg, scenario: f.scenario }
  })
  const derived = findings.some((f: Finding) => BLOCKING.includes(f.severity)) ? 'changes' : 'clean'
  const noted = new Set((Array.isArray(raw.checked) ? raw.checked : []).filter((c: any) => c && typeof c.note === 'string' && c.note.trim() && c.note.length <= MAX_TEXT).map((c: any) => c.area))
  const missing = CHECKED_AREAS.filter((a) => !noted.has(a))
  const problem = raw.verdict !== derived ? `the declared verdict "${raw.verdict}" contradicts the findings (${derived})` : missing.length ? `the review did not account for: ${missing.join(', ')}` : undefined
  return { verdict: raw.verdict !== derived ? 'changes' : derived, findings, markdown: raw.markdown, ...(problem && { problem }) }
}

const oneLine = (v: unknown) => String(v).replace(/\s+/g, ' ').trim()
const findingLine = (f: Finding) => `- [${oneLine(f.severity)}] ${oneLine(f.file)}:${oneLine(f.line)} ${oneLine(f.msg)} Scenario: ${oneLine(f.scenario)}`

/** The MR body has a `## Evidence` heading followed by content. */
export const hasEvidence = (body: string): boolean => !!/^##[ \t]+Evidence\b[^\n]*$([\s\S]*?)(?=^#{1,2}[ \t]|(?![\s\S]))/im.exec(body)?.[1]?.trim()

type Mr = NonNullable<Awaited<ReturnType<typeof prOf>>>

/** Moves `reviewState` only out of "open" states (unset or waiting_checks); true when this call did it. The conditional UPDATE is what keeps two ticks from merging twice. `reviewWaitingSince` starts with the first wait and clears on any other state. */
const moveReview = async (payload: Payload, ticket: TicketId, to: string | null, from: 'open' | 'merged' = 'open'): Promise<boolean> =>
  (
    await payload.db.drizzle.execute(
      sql`UPDATE "tickets" SET "review_state" = ${to}::"enum_tickets_review_state", "review_waiting_since" = CASE WHEN ${to}::text = 'waiting_checks' THEN COALESCE("review_waiting_since", now()) END, "updated_at" = now() WHERE "id" = ${ticket} AND ${from === 'open' ? sql`("review_state" IS NULL OR "review_state" = 'waiting_checks')` : sql`"review_state" = 'merged'`} RETURNING "id"`,
    )
  ).rows.length > 0

/** Parks the Ticket on a human with a Ticket comment (never overwrites a completed merge). */
const escalate = async (payload: Payload, t: Doc, why: string): Promise<ReviewOutcome> => {
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = 'needs_human', "review_waiting_since" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "review_state" IS DISTINCT FROM 'merged'`)
  const { ts, n } = await sourceOf(payload, t)
  await ts.comment(n, `Bauherr needs a human: ${why}`)
  return 'needs_human'
}

const handOver = async (payload: Payload, t: Doc, mr: Mr, message: string): Promise<ReviewOutcome> => {
  if (await moveReview(payload, t.id, 'ready_for_human')) await mr.tickets.comment(String(t.number), `${message}\n${mr.pr.url}`)
  return 'ready_for_human'
}

/**
 * Back to Build on the same MR: counts a round; the 3rd return needs a human. Findings become the worklog's Current instructions and Unfinished work.
 * Only acts while the Ticket is in review with an open state and the MR is still open (re-read); otherwise `noop`. Active review Runs are cancelled.
 */
const returnToBuild = async (payload: Payload, t: Doc, mr: Mr, reason: string, lines: string[]): Promise<ReviewOutcome> => {
  if ((await mr.backend.forge.getPullRequest(mr.repo, mr.pr.number)).state !== 'open') return 'noop'
  const claimed = (
    await payload.db.drizzle.execute(
      sql`UPDATE "tickets" SET "review_rounds" = COALESCE("review_rounds", 0) + 1, "merge_failures" = 0, "review_waiting_since" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "stage" = 'review' AND ("review_state" IS NULL OR "review_state" = 'waiting_checks') RETURNING "review_rounds"`,
    )
  ).rows[0]
  if (!claimed) return 'noop'
  const rounds = Number(claimed.review_rounds)
  const n = String(t.number)
  if (rounds > MAX_REVIEW_ROUNDS) return escalate(payload, t, `${reason}, after ${MAX_REVIEW_ROUNDS} review rounds.\n\n${lines.join('\n')}`)
  const src = { ts: mr.tickets, n }
  const text = `Review round ${rounds}: ${reason}. Fix them on MR #${mr.pr.number} (branch \`${mr.pr.head}\`); push to that branch, do not open a new MR.\n${lines.join('\n')}`.replace(/^(\s*)(\*\*|#)/gm, '$1\\$2')
  const log = await worklogComment(src)
  const worklog = setSection(setInstructions(log ? log.body.slice(WORKLOG_MARKER.length).trimStart() : WORKLOG_TEMPLATE, text), '**Unfinished work**', lines.join('\n'))
  if (log) await src.ts.updateComment(n, log.id, `${WORKLOG_MARKER}\n${worklog}`)
  else await src.ts.comment(n, `${WORKLOG_MARKER}\n${worklog}`)
  await payload.update({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'review' } }, { status: { in: ACTIVE } }] }, data: { status: 'cancelled' }, overrideAccess: true })
  await startRunIfNeeded(payload, { id: t.id, workspace: t.workspace }, 'build')
  await setStage(mr.tickets, n, 'build')
  await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'build', reviewState: null }, overrideAccess: true })
  return 'build'
}

/**
 * Merge gate for a clean review of `reviewedSha`: the MR must be an open factory MR whose head is still `reviewedSha` (else a new review starts),
 * auto-merge on, `## Evidence` present, not a draft, checks and statuses green (none = green once the head is 10 minutes old). Pending waits, red returns to Build.
 */
export const mergeGate = async (payload: Payload, t: Doc, mr: Mr, reviewedSha: string | null, at = Date.now()): Promise<ReviewOutcome> => {
  if (!isFactoryPr(mr.pr, mr.repo, t.number) || mr.pr.state !== 'open') return escalate(payload, t, 'the MR is not an open factory MR of this Ticket; refusing to merge it.')
  if (mr.pr.headSha !== reviewedSha) {
    if (await moveReview(payload, t.id, null)) await startRunIfNeeded(payload, { id: t.id, workspace: t.workspace }, 'review')
    return 'review_restarted'
  }
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), depth: 0, overrideAccess: true })) as Doc
  if (product.autoMerge === false) return handOver(payload, t, mr, 'Review clean, ready to merge by a human: auto-merge is off for this Product.')
  if (!hasEvidence(mr.pr.body)) return handOver(payload, t, mr, 'Review clean, ready to merge by a human: the MR body has no `## Evidence` section with content.')
  if (mr.pr.draft) {
    await moveReview(payload, t.id, 'waiting_checks')
    return 'waiting_checks'
  }
  const list = await mr.backend.forge.listChecks(mr.repo, mr.pr.headSha)
  const age = list.length ? Infinity : at - Date.parse(await mr.backend.forge.getCommitDate(mr.repo, mr.pr.headSha))
  const checks = mergeChecks(list, age)
  if (checks.state === 'red') return returnToBuild(payload, t, mr, `checks failed on the MR head: ${checks.failed.join(', ')}`, checks.failed.map((c) => `- [high] check \`${c}\` is red on ${mr.pr.headSha.slice(0, 7)}; make it pass.`))
  if (checks.state === 'pending') {
    await moveReview(payload, t.id, 'waiting_checks')
    return 'waiting_checks'
  }
  if (!(await moveReview(payload, t.id, 'merged'))) return 'waiting_checks'
  try {
    const merged = await mr.backend.forge.mergePullRequest(mr.repo, mr.pr.number, { method: 'squash', deleteBranch: true, expectSha: reviewedSha })
    if (merged.branchDeleteError) payload.logger.warn({ ticket: t.id, err: merged.branchDeleteError }, 'merged, but deleting the head branch failed')
  } catch (e) {
    await moveReview(payload, t.id, 'waiting_checks', 'merged')
    payload.logger.error({ err: e, ticket: t.id }, 'merging the MR failed')
    const failures = Number((await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "merge_failures" = COALESCE("merge_failures", 0) + 1 WHERE "id" = ${t.id} RETURNING "merge_failures"`)).rows[0]!.merge_failures)
    return failures >= MAX_MERGE_FAILURES ? escalate(payload, t, `merging the MR failed ${failures} times in a row: ${e instanceof Error ? e.message : String(e)}`) : 'waiting_checks'
  }
  return 'merged'
}

/**
 * Both review paths end here, after the review Run holds its verdict on `reviewedSha`: posts the MR comment, then hands an unusable review to a human,
 * returns to Build (blocking findings) or runs the merge gate. Never throws: a failure parks the Ticket on a human and the (succeeded) Run stays as it is.
 */
export const concludeReview = async (payload: Payload, ticket: TicketId, review: Review, reviewedSha: string | null): Promise<{ outcome: ReviewOutcome }> => {
  const t = (await payload.findByID({ collection: 'tickets', id: ticket, depth: 0, overrideAccess: true })) as Doc
  try {
    const mr = await prOf(payload, t)
    if (!mr || mr.pr.state !== 'open') throw new Error('the Ticket has no open factory MR')
    await mr.backend.forge.commentOnPullRequest(mr.repo, mr.pr.number, `${REVIEW_MARKER}\n${review.markdown.slice(0, MAX_MARKDOWN)}`)
    if (review.problem) return { outcome: await handOver(payload, t, mr, `Review needs a human: ${review.problem}.`) }
    const blocking = review.findings.filter((f) => BLOCKING.includes(f.severity))
    const outcome = blocking.length
      ? await returnToBuild(payload, t, mr, `the review found ${blocking.length} blocking issue(s)`, blocking.map(findingLine))
      : await mergeGate(payload, t, mr, reviewedSha)
    return { outcome }
  } catch (e) {
    payload.logger.error({ err: e, ticket: t.id }, 'concluding the review failed')
    return { outcome: await escalate(payload, t, `concluding the review failed: ${e instanceof Error ? e.message : String(e)}`) }
  }
}

/** Per-minute pass: Tickets waiting on checks re-run the merge gate against the latest reviewed SHA; waiting longer than 2 hours needs a human. */
export const watchReviews = async (payload: Payload, at = Date.now()): Promise<number> => {
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ state: { equals: 'open' } }, { stage: { equals: 'review' } }, { reviewState: { equals: 'waiting_checks' } }] }, limit: 200, pagination: false, depth: 0, overrideAccess: true })).docs as Doc[]
  let merged = 0
  for (const t of tickets) {
    try {
      if (t.reviewWaitingSince && at - Date.parse(t.reviewWaitingSince) > WAIT_CHECKS_MAX_MS) {
        await escalate(payload, t, 'the MR has been waiting on checks (or as a draft) for more than 2 hours.')
        continue
      }
      const mr = await prOf(payload, t)
      if (mr?.pr.state !== 'open') continue
      const last = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'review' } }, { status: { equals: 'succeeded' } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })).docs[0] as Doc | undefined
      if ((await mergeGate(payload, t, mr, last?.reviewedSha ?? null, at)) === 'merged') merged++
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'watch-reviews failed for ticket')
    }
  }
  return merged
}
