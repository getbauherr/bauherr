import { createHash } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { type StatusRun, ticketStatus } from '../app/(app)/lib/status'
import { workflowFor } from './factory'
import { gateOwnersOf } from './gates'
import { APPROVED_STAGING, type Need } from './needs-you'
import { cas, forgeOf, id } from './release'
import { fillPlaceholders, type Section } from './template-text'
import { packTemplate, template, type Tpl } from './templates'
import { byKind, type Kind, title as stageTitle, type Workflow } from './workflow'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export const PROGRESS_MARKER = '<!-- bauherr:progress -->'
/** The six steps of the path every request takes, in plain words; stage kinds map onto them, stage names never appear. */
export const PATH = ['Received', 'Planned', 'Built', 'Reviewed', 'On staging', 'Released'] as const
const STEP_OF: Partial<Record<Kind, number>> = { triage: 0, plan: 1, container: 1, build: 2, review: 3, release: 4, done: 5 }
/** The keys whose arrival is worth a Comment that mentions the author: a question for them, ready to accept, released, stuck. */
export const NOTIFY = ['question', 'staging', 'released', 'stuck'] as const

export type ProgressKey = 'received' | 'question' | 'planning' | 'approval' | 'building' | 'reviewing' | 'agent' | 'human' | 'staging' | 'waiting' | 'released' | 'stuck' | 'closed' | 'split' | 'blocked'
export type Progress = { key: ProgressKey; headline: string; detail?: string; next?: string; link?: string; /** Index into PATH of the current step; null when the request ended without a change. */ step: number | null }
export type ProgressFacts = {
  run: StatusRun | null
  needsYou: Need | null
  blockedBy?: { number: number }[]
  children?: { total: number; done: number } | null
  stagingUrl?: string | null
  /** The Ticket page in the factory, for the keys where a person with a login acts there. */
  link?: string
}

const STUCK_NEED: Partial<Record<Need, string>> = {
  'Run failed': 'the automated work on it failed',
  'Run needs you': 'the automated work needs a decision from a person',
  Cancelled: 'the work was cancelled',
  'Release failed': 'publishing the release failed',
  'Production deploy failed': 'the deploy to production failed',
  'Staging not confirmed': 'the change could not be confirmed on staging',
  'Round cap reached': 'the review found something a person has to decide',
  'Needs you': 'the review found something a person has to decide',
  'Configure production checks': 'the checks for going live are not set up yet',
}
const STUCK_CAUSE: Record<string, string> = {
  'triage-expired': 'the first reading did not finish',
  'mr-missing': 'the change lost its merge request',
  'checks-red': 'the automated checks fail',
  'run-failed': 'the last attempt failed',
  'run-cancelled': 'the work was cancelled',
  'run-abandoned': 'the working session was abandoned',
  'run-stuck': 'the work stopped without a result',
  'review-escalated': 'the review needs a person',
  'review-invalid': 'the review did not produce a usable result',
  'review-stalled': 'it waits for someone to merge it',
}

/** The current step: the stage's own kind, or for a custom stage the nearest built-in kind before it in the workflow. */
export const stepOf = (wf: Workflow, stage: string): number => {
  for (let i = wf.stages.findIndex((s) => s.name === stage); i >= 0; i--) {
    const step = STEP_OF[wf.stages[i]!.kind]
    if (step !== undefined) return step
  }
  return 0
}

/** The path as plain markdown: finished steps ticked, the current one in bold. */
export const pathMarkdown = (step: number): string => PATH.map((p, i) => (i < step ? `${p} ✓` : i === step ? `**${p} (now)**` : p)).join(' → ')

const kindKey: Partial<Record<Kind, ProgressKey>> = { triage: 'received', plan: 'planning', container: 'split', build: 'building', review: 'reviewing', agent: 'agent', human: 'human', release: 'waiting' }

/** One line of a staging summary's "what you get": its leading bullets. */
const noteOf = (whatYouGet: unknown): string => {
  const lines = String(whatYouGet ?? '').split('\n').map((l) => l.trim())
  const head = lines.slice(0, Math.max(0, lines.findIndex((l) => l.startsWith('**'))) || lines.length)
  return head.filter((l) => /^[-*]\s/.test(l)).map((l) => l.replace(/^[-*]\s+/, '')).slice(0, 3).join(' ')
}

const sectionOf = (tpl: Tpl, key: string): Section | undefined => tpl.parsed.find((s) => s.id === key) ?? packTemplate('progress').parsed.find((s) => s.id === key)

/**
 * Where a Ticket stands, in plain words by stage KIND (a custom stage uses its `title`). Built on `ticketStatus`, the one status every page shows, so the two cannot disagree;
 * the text of each key is the Workspace's `progress` template. `t` is a Ticket row, `facts` what the row does not hold.
 */
export const progressOf = (wf: Workflow, t: Doc, facts: ProgressFacts, tpl: Tpl): Progress => {
  const stage: string = t.stage ?? byKind(wf, 'triage')!.name
  const kind = wf.stages.find((s) => s.name === stage)?.kind
  const open = t.state !== 'closed'
  const status = ticketStatus(wf, { open, stage, needsYou: facts.needsYou, blockedBy: facts.blockedBy ?? [], queuedWhy: null, run: facts.run, owner: null, forge: null, gate: null, children: facts.children ?? null, track: { waitingFor: t.waitingFor, reviewState: t.reviewState, releaseState: t.releaseState, productionState: t.productionState, releaseChecksState: t.releaseChecksState } })
  const vars: Record<string, string | undefined> = { stage_title: stageTitle(wf, stage), staging_url: facts.stagingUrl ?? undefined }
  let key: ProgressKey = kindKey[kind as Kind] ?? 'received'
  let step: number | null = stepOf(wf, stage)
  const need = facts.needsYou
  if (status.phase === 'done') {
    const changed = !!(t.mergeSha || t.releasedAt || t.releasedIn || t.productionState === 'deployed' || t.labels?.includes(APPROVED_STAGING))
    key = changed || !byKind(wf, 'release') ? 'released' : 'closed'
    step = key === 'released' ? 5 : null
    vars.release_note = noteOf(t.stagingTldr?.whatYouGet)
  } else if (status.phase === 'blocked' && kind === 'container') {
    vars.children = status.detail ?? undefined
  } else if (status.phase === 'human' && need && need !== 'Expedite?') {
    if (need === 'Answer questions' || need === 'Answer decisions') key = 'question'
    else if (need === 'Approve plan') key = 'approval'
    else if (need === 'Accept on staging') key = 'staging'
    else if (need === 'Decision needed') key = 'human'
    else if (need === 'Approve production') (key = 'waiting', (vars.waiting = 'Accepted. Waiting for approval to go live.'))
    else (key = 'stuck', (vars.reason = STUCK_NEED[need] ?? 'it needs a person'))
  } else if (status.phase === 'queued' && t.liveness?.cause) (key = 'stuck', (vars.reason = STUCK_CAUSE[t.liveness.cause] ?? 'nothing is moving'))
  else if (status.phase === 'ci') {
    key = 'waiting'
    vars.waiting = status.label === 'Waiting on merge queue' ? 'Waiting in the merge queue.' : status.detail === 'the staging deploy' ? 'Being deployed to staging.' : status.detail === 'the production deploy' ? 'Being released to production.' : 'Waiting for the automated checks to pass.'
  } else if (status.phase === 'blocked') (key = 'blocked', (vars.blockers = (facts.blockedBy ?? []).map((b) => `#${b.number}`).join(', ')))
  else if (status.phase === 'failed') (key = 'stuck', (vars.reason = 'the last attempt failed'))
  else if (kind === 'release') (key = 'waiting', (vars.waiting = 'Being deployed to staging.'))
  const lines = fillPlaceholders(sectionOf(tpl, key)?.text ?? '', vars).split('\n').map((l) => l.trim()).filter(Boolean)
  const next = lines.find((l) => l.startsWith('Next: '))?.slice(6)
  const [headline = key, ...rest] = lines.filter((l) => !l.startsWith('Next: '))
  return { key, headline, ...(rest.length && { detail: rest.join('\n') }), ...(next && { next }), ...(facts.link && ['question', 'approval', 'staging', 'human', 'stuck'].includes(key) && { link: facts.link }), step }
}

/** The body of the progress Comment, without its time stamp (the part that decides whether the Comment changed). */
const bodyOf = (p: Progress): string =>
  [PROGRESS_MARKER, `**${p.headline}**`, ...(p.detail ? [p.detail] : []), ...(p.next ? [`**Next:** ${p.next}`] : []), ...(p.step === null ? [] : [pathMarkdown(p.step)])].join('\n\n')

/** Progress of Ticket rows, DB only: the latest Run, open blockers, sub-ticket counts, the Product's staging URL, the Workspace's `progress` template and since when the Ticket is in this state. */
export const loadProgress = async (payload: Payload, tickets: Doc[]): Promise<Map<number, Progress & { since: string | null }>> => {
  const out = new Map<number, Progress & { since: string | null }>()
  if (!tickets.length) return out
  const ids = tickets.map((t) => t.id as number)
  const first = <T extends Doc>(rows: T[], by: (r: T) => number) => {
    const m = new Map<number, T>()
    for (const r of rows) if (!m.has(by(r))) m.set(by(r), r)
    return m
  }
  const runs = first((await payload.find({ collection: 'runs', where: { ticket: { in: ids } }, sort: '-createdAt', select: { ticket: true, stage: true, kind: true, status: true, reasonKind: true, error: true, mode: true, startedAt: true, createdAt: true }, pagination: false, ...o })).docs as Doc[], (r) => id(r.ticket) as number)
  const events = first((await payload.find({ collection: 'ticket_events', where: { ticket: { in: ids } }, sort: '-at', select: { ticket: true, at: true }, pagination: false, ...o })).docs as Doc[], (r) => id(r.ticket) as number)
  const blockerIds = [...new Set(tickets.flatMap((t) => ((t.blockedBy ?? []) as unknown[]).map(id) as number[]))]
  const blockers = blockerIds.length ? (await payload.find({ collection: 'tickets', where: { and: [{ id: { in: blockerIds } }, { state: { equals: 'open' } }] }, select: { number: true }, pagination: false, ...o })).docs as Doc[] : []
  const children = (await payload.find({ collection: 'tickets', where: { parent: { in: ids } }, select: { parent: true, state: true }, pagination: false, ...o })).docs as Doc[]
  const productIds = [...new Set(tickets.map((t) => id(t.product) as number))]
  const products = new Map(((await payload.find({ collection: 'products', where: { id: { in: productIds } }, select: { stagingUrl: true }, pagination: false, ...o })).docs as Doc[]).map((p) => [p.id as number, p.stagingUrl as string | null]))
  const tpls = new Map<number, Tpl>()
  for (const t of tickets) {
    const ws = id(t.workspace) as number
    if (!tpls.has(ws)) tpls.set(ws, await template(payload, ws, 'progress'))
    const kids = children.filter((c) => id(c.parent) === t.id)
    const p = progressOf(workflowFor(t.workspace), t, {
      run: (runs.get(t.id) as StatusRun | undefined) ?? null,
      needsYou: t.needsYou ?? null,
      blockedBy: blockers.filter((b) => ((t.blockedBy ?? []) as unknown[]).map(id).includes(b.id)).map((b) => ({ number: b.number })),
      children: kids.length ? { total: kids.length, done: kids.filter((c) => c.state === 'closed').length } : null,
      stagingUrl: products.get(id(t.product) as number) ?? null,
      link: `/tickets/${t.id}`,
    }, tpls.get(ws)!)
    out.set(t.id, { ...p, since: (events.get(t.id)?.at as string | undefined) ?? (t.updatedAt as string | undefined) ?? null })
  }
  return out
}

const hashOf = (s: string) => createHash('sha1').update(s).digest('hex')
const stamp = () => `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** Edits the one progress Comment of the issue in place (found by its marker, then by the stored id); the first post is a list plus a create, every later change one update. */
const write = async (payload: Payload, t: Doc, body: string): Promise<string> => {
  const { tickets: ts } = await forgeOf(payload, id(t.product))
  const n = String(t.number)
  if (t.progressCommentId) {
    try {
      return (await ts.updateComment(n, t.progressCommentId, body)).id
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e
    }
  }
  const found = (await ts.listComments(n)).find((c) => c.body.startsWith(PROGRESS_MARKER))
  return (found ? await ts.updateComment(n, found.id, body) : await ts.comment(n, body)).id
}

const isBot = async (ts: { whoami(): Promise<string | null> }, login: string): Promise<boolean> =>
  /\[bot\]$/.test(login) || login === process.env.BAUHERR_BOT_LOGIN || login === (await ts.whoami().catch(() => null))

/**
 * Mentions the issue's author in one NEW Comment (editing a Comment mails nobody) when the Ticket arrives at a key in NOTIFY; once per arrival, claimed on `progressNotified` before the post and
 * released when the forge refuses. Leaving the key ends the episode. Nobody is mentioned when the author is the factory's own account (Intake issues) or the gate Comment of `syncGate` already mentioned them.
 */
const notify = async (payload: Payload, t: Doc, p: Progress): Promise<void> => {
  const key = (NOTIFY as readonly string[]).includes(p.key) ? p.key : null
  if (!key) {
    if (t.progressNotified) await cas(payload, t.id, sql`"progress_notified" = NULL`, sql`"progress_notified" IS NOT NULL`)
    return
  }
  if (t.progressNotified === key || !(await cas(payload, t.id, sql`"progress_notified" = ${key}`, sql`"progress_notified" IS DISTINCT FROM ${key}`))) return
  try {
    const { tickets: ts } = await forgeOf(payload, id(t.product))
    const author = (await ts.get(String(t.number))).author
    if (!author || (await isBot(ts, author))) return
    if (t.gateNotified && (await gateOwnersOf(payload, await payload.findByID({ collection: 'products', id: id(t.product), ...o }))).includes(author)) return
    await ts.comment(String(t.number), `<!-- bauherr:progress-notice:${key} -->\n@${author}: ${p.headline}${p.next ? ` ${p.next}` : ''}`)
  } catch (e) {
    await cas(payload, t.id, sql`"progress_notified" = ${t.progressNotified ?? null}`, sql`"progress_notified" = ${key}`)
    throw e
  }
}

/**
 * Keeps the progress Comment of each Ticket's issue current (unchanged = no forge call; the body hash lives in `tickets.progressHash`, claimed before the write and released when it fails)
 * and posts the notices. Per Ticket, a failure is logged; with `strict` (the job) it is thrown after the others were handled so the queue retries, otherwise the next sweep retries an existing Comment. Returns how many Comments were written.
 */
export const syncProgress = async (payload: Payload, ticketIds: (number | string)[], opts: { strict?: boolean } = {}): Promise<number> => {
  if (!ticketIds.length) return 0
  const rows = (await payload.find({ collection: 'tickets', where: { id: { in: ticketIds } }, pagination: false, ...o })).docs as Doc[]
  const off = new Set(((await payload.find({ collection: 'workspaces', where: { progressComments: { equals: false } }, select: {}, pagination: false, ...o })).docs as Doc[]).map((w) => w.id))
  const tickets = rows.filter((t) => !off.has(id(t.workspace)) && t.number != null)
  let written = 0
  let failure: unknown
  let progress: Awaited<ReturnType<typeof loadProgress>>
  try {
    progress = await loadProgress(payload, tickets)
  } catch (e) {
    payload.logger.error({ err: e }, 'progress could not be computed')
    return 0
  }
  for (const t of tickets) {
    const p = progress.get(t.id)!
    const body = bodyOf(p)
    const hash = hashOf(body)
    try {
      if (t.progressHash !== hash && (await cas(payload, t.id, sql`"progress_hash" = ${hash}`, sql`"progress_hash" IS DISTINCT FROM ${hash}`))) {
        try {
          const commentId = await write(payload, t, `${body}\n\n<sub>Updated ${stamp()}</sub>`)
          if (commentId !== t.progressCommentId) await cas(payload, t.id, sql`"progress_comment_id" = ${commentId}`, sql`true`)
          written++
        } catch (e) {
          await cas(payload, t.id, sql`"progress_hash" = ${t.progressHash ?? null}`, sql`"progress_hash" = ${hash}`)
          throw e
        }
      }
      await notify(payload, t, p)
    } catch (e) {
      payload.logger.warn({ err: e, ticket: t.id }, 'syncing the progress Comment failed')
      failure ??= e
    }
  }
  // The job asks for `strict` so a failed first post is retried by the job queue (the sweep never creates a Comment).
  if (opts.strict && failure) throw failure
  return written
}
