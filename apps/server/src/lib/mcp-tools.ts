import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { FILE_PATTERN, acceptStaging, approvePlan, approveProduction, concludeReview, grantReviewRound, sendBackToBuild, stopReview, normalizeReview, normalizeTriage, postStagingSummary, readWorklog, requestChanges, requestReview, scoped as scopedUser, sourceOf, submitPlan, submitTriage, tenantsOf, updateWorklog } from './actions'
import { SESSION_TIMEOUT_MS, startReviewIfReady } from '../jobs'
import { assertOpenFactoryMr, prOf } from './release'
import { preReviewFailures } from './pre-review'
import { logins, ownsGate } from './gates'
import { baseCaps, escalatedCaps, isEscalated, noteEscalatedBuild, submitInvestigation, type InvestigationInput } from './investigation'
import { AGENT_REPAIRED, deadTickets } from './liveness'
import { isExpediting } from './expedite'
import { executionOrder, frontierOrder, type FrontierTicket } from './frontier'
import { untrustedBlock } from '@bauherr/runner'
import { goalFor } from './run-ctx'
import * as knowledge from './knowledge'

type Doc = Record<string, any>
export interface Ctx {
  payload: Payload
  user: Doc
  /** Who is calling: only a personal API key (or the UI) is `human`; session Runs use an agent key. */
  actor: { kind: 'agent'; keyId: number | string } | { kind: 'human' }
  /** Set by handlers once a Run or Ticket is loaded; used for the tool_calls row. */
  workspace?: number | string
  run?: number | string
  /** Name of the tool being called; recorded as the Run's `last_lease_call`. */
  tool?: string
}
export interface Tool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  /** Required, no default: `callTool` lets an agent key call only `'agent'` tools; owner decisions (gates) are `'human'`. */
  access: 'agent' | 'human'
  run: (a: any, c: Ctx) => Promise<unknown>
}

const PACK = () => resolve(process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack'))
const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const now = () => new Date().toISOString()


const scoped = (c: Ctx) => scopedUser(c.user)

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex')

/** True when `token` hashes to the Run's `leaseHash`. */
const holdsLease = (run: Doc, token: unknown): boolean => {
  if (typeof token !== 'string' || typeof run.leaseHash !== 'string') return false
  const [a, b] = [Buffer.from(sha256(token)), Buffer.from(run.leaseHash)]
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The live lease: session Run still running, `leaseToken` valid and the last heartbeat younger than SESSION_TIMEOUT_MS. */
const assertLease = (run: Doc, a: { leaseToken?: unknown }): void => {
  if (run.mode !== 'session') throw new Error(`run ${run.id} is not a session Run`)
  if (run.status !== 'running') throw new Error(`lease lost: run ${run.id} is ${run.status}`)
  if (!holdsLease(run, a.leaseToken)) throw new Error(`run ${run.id} is leased by another session`)
  if (!(new Date(run.heartbeatAt).getTime() > Date.now() - SESSION_TIMEOUT_MS)) throw new Error(`lease lost: run ${run.id} expired`)
}

const U = sql`"updated_at" = now()`

/**
 * Applies `set` to the Run only while it is still running, holds `token` and its heartbeat is fresh (one conditional UPDATE); else `lease lost`.
 * Every successful call also renews the lease (`heartbeat_at = now()`, unless `renew` is false because `set` clears it) and returns the new `leaseExpiresAt` (ISO).
 * A wrong token or an expired lease matches no row, so it never renews.
 */
const renewLease = async (c: Ctx, run: Doc, token: unknown, set: ReturnType<typeof sql> = U, renew = true): Promise<string> => {
  const beat = renew ? sql`"heartbeat_at" = now(), ` : sql``
  const r = await c.payload.db.drizzle.execute(
    sql`UPDATE "runs" SET ${beat}"last_lease_call" = ${c.tool ?? null}, ${set} WHERE "id" = ${run.id} AND "status" = 'running' AND "lease_hash" = ${sha256(String(token))} AND "heartbeat_at" > now() - make_interval(secs => ${SESSION_TIMEOUT_MS / 1000}) RETURNING (extract(epoch from "heartbeat_at") * 1000)::float8 AS "ms"`,
  )
  if (!r.rows.length) throw new Error(`lease lost: run ${run.id}`)
  return renew ? new Date(Number(r.rows[0].ms) + SESSION_TIMEOUT_MS).toISOString() : '' // no lease after release
}
const ownerWrite = renewLease

/** Loads a Run in the caller's Workspace; `own` additionally requires the live lease. */
const getRun = async (c: Ctx, runId: number | string, own?: { leaseToken?: unknown }): Promise<Doc> => {
  const run = (await c.payload.findByID({ collection: 'runs', id: runId, ...scoped(c), showHiddenFields: true })) as Doc
  c.workspace = id(run.workspace)
  c.run = run.id
  if (own) assertLease(run, own)
  return run
}

const getTicket = async (c: Ctx, ticketId: number | string): Promise<Doc> => {
  const t = (await c.payload.findByID({ collection: 'tickets', id: ticketId, ...scoped(c) })) as Doc
  c.workspace = id(t.workspace)
  return t
}

const walk = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
    .filter((e) => e.isFile() && /\.(md|ya?ml|ts|sh)$/.test(e.name))
    .map((e) => relative(dir, resolve(e.parentPath, e.name)))

const packFile = (path: string): string => {
  const root = PACK()
  const abs = resolve(root, path)
  if (!abs.startsWith(root + sep)) throw new Error('path outside pack')
  return readFileSync(abs, 'utf8')
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Tool['inputSchema'] => ({ type: 'object', properties, ...(required.length ? { required } : {}) })
const str = (description: string) => ({ type: 'string', description })
const runId = { runId: { type: ['number', 'string'], description: 'Run id' } }
const leaseToken = { leaseToken: str('Lease token returned by claim_run') }
const sessionArg = { session: str('Stable name of this session (max 64 chars). Pass it on every claim_next, claim_run and list_frontier: a Review of a build you labelled the same is skipped as "your own build".') }
const ticketId = { ticket: { type: ['number', 'string'], description: 'Ticket id (Bauherr database id)' } }

class ClaimLost extends Error {}

/** The caller's session label, or null when it sent none (such a session is never skipped). */
const labelOf = (a: { session?: unknown }): string | null => {
  if (a.session == null) return null
  if (typeof a.session !== 'string' || a.session.length > 64) throw new Error('session must be a string of at most 64 characters')
  return a.session.trim() || null
}

/** The GitHub login a session Run assigns on the Ticket. */
const sessionLogin = (c: Ctx): string | undefined => (c.user.githubLogin as string | undefined) ?? process.env.BAUHERR_BOT_LOGIN

/** Claims an awaiting_session Run for the caller and returns the `claim_run` payload; `ClaimLost` when another claimer won. */
const claimRun = async (c: Ctx, runId: number | string, label: string | null = null) => {
  const run = await getRun(c, runId)
  const notClaimable = `run ${run.id} is ${run.mode}/${run.status}, not awaiting_session`
  if (run.mode !== 'session') throw new Error(notClaimable)
  // A session already holds it: the loser of a claim race gets the same message whether it read before or after the winner committed.
  if (run.status === 'running') throw new ClaimLost(`run ${run.id} was claimed by someone else`)
  if (run.status !== 'awaiting_session') throw new ClaimLost(notClaimable)
  const ticket = await getTicket(c, id(run.ticket))
  if (ticket.stage === 'parent') throw new Error('parents are not claimable')
  const { ts, n } = await sourceOf(c.payload, ticket)
  const body = (await ts.get(n)).body
  const statements = await goalFor(c.payload, ticket, body, run.stage)
  const leaseToken = randomBytes(32).toString('base64url')
  // Single conditional UPDATE (goal included): Payload's update-by-where is find-then-update and lets two claimers both win.
  const claimed = await c.payload.db.drizzle.execute(
    sql`UPDATE "runs" SET "status" = 'running', "session_owner_id" = ${c.user.id}, "agent_key_id" = ${c.actor.kind === 'agent' ? c.actor.keyId : null}, "session_label" = ${label}, "lease_hash" = ${sha256(leaseToken)}, "heartbeat_at" = now(), "last_lease_call" = ${c.tool ?? null}, "started_at" = now(), "goal" = ${JSON.stringify({ statements })}::jsonb, ${U} WHERE "id" = ${run.id} AND "workspace_id" = ${id(run.workspace)} AND "status" = 'awaiting_session' RETURNING "id"`,
  )
  if (!claimed.rows.length) throw new ClaimLost(`run ${run.id} was claimed by someone else`)
  const won = await c.payload.findByID({ collection: 'runs', id: run.id, ...scoped(c) })
  const login = sessionLogin(c)
  if (login) {
    try {
      await ts.claim(n, login)
    } catch (e) {
      await c.payload.update({ collection: 'runs', id: run.id, data: { status: 'awaiting_session', sessionOwner: null, agentKey: null, leaseHash: null, heartbeatAt: null }, overrideAccess: true })
      throw e
    }
  }
  // Triage and Review Runs read text others wrote: hand it over fenced as data (the stored Goal stays plain).
  const fence = run.stage === 'triage' || run.stage === 'review'
  const shown = fence ? { title: untrustedBlock(ticket.title), body: untrustedBlock(body) } : { title: ticket.title, body }
  const skipped = await skippedBefore(c, ticket, label)
  const escalated = await isEscalated(c.payload, won)
  if (escalated && run.stage === 'build') await noteEscalatedBuild(c.payload, won, escalatedCaps('build', baseCaps('build')))
  return { run: escalated ? { ...won, tier: 'strong', ...(won.investigation && !won.escalation && { escalation: { step: 3, reason: 'failed twice: investigate', previousRuns: won.investigation.failedRuns } }) } : won, leaseToken, skipped, ticket: { id: ticket.id, number: ticket.number, url: ticket.url, ...shown, ...(run.stage === 'review' && ticket.conflictReturnBase && { conflictReturnBase: ticket.conflictReturnBase }) }, goal: run.stage === 'triage' ? [untrustedBlock(statements.map((s) => `- ${s}`).join('\n'))] : statements, assignedTo: login ?? null }
}

type Frontier = { open: Doc[]; latest: Map<unknown, Doc>; all: Doc[]; builders: Map<unknown, string | null> }

/** Open, unblocked, non-parent Tickets in frontier order with their latest Run; `all` also holds the blocked ones (for skip reasons). */
const frontier = async (c: Ctx, productSlug?: string): Promise<Frontier | null> => {
  const product = productSlug
    ? (await c.payload.find({ collection: 'products', where: { slug: { equals: productSlug } }, limit: 1, ...scoped(c) })).docs[0]
    : null
  if (productSlug && !product) return null
  const tickets = await c.payload.find({
    collection: 'tickets',
    where: { and: [{ state: { equals: 'open' } }, ...(product ? [{ product: { equals: product.id } }] : [])] },
    pagination: false,
    ...scoped(c),
    depth: 1,
  })
  const all = tickets.docs.filter((t: Doc) => t.stage !== 'parent')
  for (const t of all) t.expediting = await isExpediting(c.payload, t)
  const unblocked = all.filter((t: Doc) => !openBlockers(t).length)
  const runs = await c.payload.find({
    collection: 'runs',
    where: { ticket: { in: unblocked.map((t) => t.id) } },
    sort: '-createdAt',
    pagination: false,
    ...scoped(c),
  })
  const latest = new Map<unknown, Doc>()
  const builders = new Map<unknown, string | null>()
  for (const r of runs.docs as Doc[]) {
    if (!latest.has(id(r.ticket))) latest.set(id(r.ticket), r)
    if (r.stage === 'build' && !builders.has(id(r.ticket))) builders.set(id(r.ticket), r.sessionLabel ?? null)
  }
  return { open: frontierOrder(unblocked as Doc[] as (Doc & { id: number; number: number })[], latest as Map<number, Doc & { stage: string; status: string }>), latest, all, builders }
}

const openBlockers = (t: Doc): Doc[] => ((t.blockedBy as Doc[]) ?? []).filter((b) => b.state === 'open')

/** Names of the sessions holding a lease in `latest`, by user id. */
const leaseOwners = async (c: Ctx, latest: Map<unknown, Doc>): Promise<Map<unknown, string>> => {
  const leases = [...latest.values()].filter((r) => r.status === 'running' && r.mode === 'session')
  return new Map<unknown, string>(
    (await c.payload.find({ collection: 'bauherren', where: { id: { in: leases.map((r) => id(r.sessionOwner)) } }, limit: 100, depth: 0, overrideAccess: true })).docs.map((u: Doc) => [u.id, u.name ?? u.email]),
  )
}

/** A Review Run on a Ticket whose latest Build Run came from the caller's own (non-empty) session label. */
const isOwnBuild = (t: Doc, f: Frontier, label: string | null): boolean => !!label && f.latest.get(t.id)?.stage === 'review' && f.builders.get(t.id) === label

/** Why `t` cannot be claimed right now, or null when it can. */
const skipReason = (t: Doc, f: Frontier, owners: Map<unknown, string>, label: string | null): string | null => {
  const latest = f.latest
  const blockers = openBlockers(t)
  if (blockers.length) return `blocked by ${blockers.map((b) => `#${b.number}`).join(', ')}`
  const r = latest.get(t.id)
  if (r?.status === 'running' && r.mode === 'session') return `leased by ${owners.get(id(r.sessionOwner)) ?? 'another session'}`
  if (isClaimable(r) && isOwnBuild(t, f, label)) return 'your own build'
  return isClaimable(r) ? null : 'no claimable Run'
}

/** The Tickets ahead of `claimed` in the pull order that could not be claimed, with the reason. */
const skippedBefore = async (c: Ctx, claimed: Doc, label: string | null) => {
  const f = await frontier(c)
  if (!f) return []
  const owners = await leaseOwners(c, f.latest)
  return f.all
    .filter((t) => t.id !== claimed.id && executionOrder(t as FrontierTicket, claimed as FrontierTicket) < 0)
    .sort((a, b) => executionOrder(a as FrontierTicket, b as FrontierTicket))
    .flatMap((t) => {
      const reason = skipReason(t, f, owners, label)
      return reason ? [{ ticket: t.id, number: t.number, stage: t.stage, reason }] : []
    })
}

const isClaimable = (r?: Doc): boolean => r?.mode === 'session' && r.status === 'awaiting_session'

/** Runs `claim_next` could not claim (non-ClaimLost error), by id with the time: `claim_run` does not hold others back behind them for 5 minutes. In-memory, per server process. */
const failedClaims = new Map<string, number>()
const FAILED_CLAIM_MS = 5 * 60_000
const recentlyFailed = (r: Doc): boolean => Date.now() - (failedClaims.get(String(r.id)) ?? 0) < FAILED_CLAIM_MS

export const tools: Tool[] = [
  {
    name: 'list_frontier',
    access: 'agent',
    description: 'Open, unblocked Tickets with stage and latest Run state. Only claim Tickets with claimable=true; leased ones show leasedBy + leaseExpiresAt: never touch their branch or worktree.',
    inputSchema: obj({ product: str('Product slug'), ...sessionArg }),
    async run(a, c) {
      const label = labelOf(a)
      const f = await frontier(c, a.product)
      if (!f) return []
      const { open, latest } = f
      const leases = [...latest.values()].filter((r) => r.status === 'running' && r.mode === 'session')
      const owners = await leaseOwners(c, latest)
      return open.map((t: Doc) => {
        const r = latest.get(t.id)
        const claimable = isClaimable(r) && !isOwnBuild(t, f, label)
        return {
          ticket: t.id, number: t.number, title: t.title, url: t.url, stage: t.stage, labels: t.labels, assignee: t.assignee,
          run: r ? { id: r.id, stage: r.stage, status: r.status, mode: r.mode } : null,
          claimable,
          ...(!claimable && { reason: skipReason(t, f, owners, label) }),
          ...(leases.includes(r as Doc) && { leasedBy: owners.get(id(r!.sessionOwner)) ?? null, leaseExpiresAt: new Date(new Date(r!.heartbeatAt).getTime() + SESSION_TIMEOUT_MS).toISOString() }),
        }
      })
    },
  },
  {
    name: 'get_ticket',
    access: 'agent',
    description: 'Ticket pointer plus live body and Goal statements. `pr` is the open factory MR (number, url, branch): a Build Run on a Ticket with a `pr` pushes to that branch and opens no new MR.',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      const t = await getTicket(c, a.ticket)
      const { ts, n } = await sourceOf(c.payload, t)
      const live = await ts.get(n)
      const mr = await prOf(c.payload, t)
      const pr = mr?.pr.state === 'open' ? { number: mr.pr.number, url: mr.pr.url, branch: mr.pr.head } : null
      return { ...t, body: live.body, goal: await goalFor(c.payload, t, live.body, t.stage === 'build' ? 'build' : 'plan'), pr }
    },
  },
  {
    name: 'claim_run',
    access: 'agent',
    description: 'Claim an awaiting_session Run: status running, Ticket assigned. Only the Run claim_next would return is accepted (a Run whose claim failed in the last 5 minutes does not count); any other is refused with "take Run N (#T, column) first", a blocked, leased or superseded one with "not claimable now". The check is workspace-wide, while claim_next {product} is product-scoped. Prefer claim_next. Returns the leaseToken (shown once): every later call on the Run needs it, hand it to subagents.',
    inputSchema: obj({ ...runId, ...sessionArg }, ['runId']),
    async run(a, c) {
      const label = labelOf(a)
      const run = await getRun(c, a.runId)
      if (isClaimable(run)) {
        const ticket = await getTicket(c, id(run.ticket))
        if (ticket.stage === 'parent') throw new Error('parents are not claimable')
        const f = (await frontier(c))!
        if (f.latest.get(id(run.ticket))?.id !== run.id || !f.open.some((t) => t.id === ticket.id)) throw new Error(`Run ${run.id} is not claimable now (blocked, leased or superseded)`)
        const top = f.open.filter((t) => !isOwnBuild(t, f, label)).map((t) => f.latest.get(t.id)).find((r) => isClaimable(r) && !recentlyFailed(r!))
        if (isOwnBuild(ticket, f, label) && !top) throw new Error(`Run ${run.id} is your own build: another session reviews it`)
        if (top && top.id !== run.id) throw new Error(`take Run ${top.id} (#${(f.open.find((t) => f.latest.get(t.id) === top) as Doc).number}, ${top.stage}) first`)
      }
      return claimRun(c, a.runId, label)
    },
  },
  {
    name: 'claim_next',
    access: 'agent',
    description: 'Claim the top claimable Run in frontier order (Tickets of the expedite lane first, then right to left: Release, Review, Build, Plan, Triage, then the owner\'s Board rank; blocked and leased Tickets are skipped). Same payload as claim_run, or null when nothing is claimable. Two sessions calling at once get different Runs.',
    inputSchema: obj({ product: str('Product slug'), ...sessionArg }),
    async run(a, c) {
      const label = labelOf(a)
      const f = await frontier(c, a.product)
      const failed: { run: number | string; reason: string }[] = []
      for (const t of f?.open ?? []) {
        const r = f!.latest.get(t.id)
        if (!isClaimable(r) || isOwnBuild(t, f!, label)) continue
        try {
          const claimed = await claimRun(c, r!.id, label)
          return { ...claimed, skipped: [...claimed.skipped, ...failed] }
        } catch (e) {
          if (e instanceof ClaimLost) continue
          failedClaims.set(String(r!.id), Date.now())
          failed.push({ run: r!.id, reason: `claim failed: ${(e as Error).message}` })
        }
      }
      return null
    },
  },
  {
    name: 'heartbeat',
    access: 'agent',
    description: 'Keep a session Run alive; `expedite: {ticket, run}` in the answer names an unclaimed expedite Run that beats yours. Send at least every 10 minutes; 30 minutes of silence ends your lease: the Run is abandoned and a new claimable Run takes over.',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken)
      const f = await frontier(c)
      const label = (run.sessionLabel as string | null) ?? null
      const next = f?.open.find((t) => t.expediting && t.id !== id(run.ticket) && isClaimable(f.latest.get(t.id)) && !isOwnBuild(t, f, label))
      return { ok: true, leaseExpiresAt, ...(next && { expedite: { ticket: next.id, run: f!.latest.get(next.id)!.id } }) }
    },
  },
  {
    name: 'read_worklog',
    access: 'agent',
    description: 'Markdown of the Ticket\'s factory worklog comment (empty if none).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return readWorklog(c.payload, c.user, a)
    },
  },
  {
    name: 'update_worklog',
    access: 'agent',
    description: 'Create or replace the Ticket\'s worklog comment (one per Ticket, marked <!-- bauherr:worklog -->). While a session Run holds the Ticket\'s lease, its leaseToken is required.',
    inputSchema: obj({ ...ticketId, ...leaseToken, markdown: str('Full worklog, see the worklog skill template') }, ['ticket', 'markdown']),
    async run(a, c) {
      const t = await getTicket(c, a.ticket)
      const leased = (await c.payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { mode: { equals: 'session' } }, { status: { equals: 'running' } }] }, limit: 1, showHiddenFields: true, ...scoped(c) })).docs[0]
      if (leased) assertLease(leased, a)
      const written = await updateWorklog(c.payload, c.user, a)
      const leaseExpiresAt = leased ? await renewLease(c, leased, a.leaseToken) : undefined
      return { ...written, ...(leaseExpiresAt && { leaseExpiresAt }) }
    },
  },
  {
    name: 'report_step',
    access: 'agent',
    description: 'Record a Step of your session Run.',
    inputSchema: obj({ ...runId, ...leaseToken, summary: str('What was done'), tokens: { type: 'object', properties: { in: { type: 'number' }, out: { type: 'number' } } } }, ['runId', 'leaseToken', 'summary']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken)
      const seq = (await c.payload.count({ collection: 'steps', where: { run: { equals: run.id } }, overrideAccess: true })).totalDocs + 1
      const step = await c.payload.create({
        collection: 'steps',
        data: { run: run.id, workspace: id(run.workspace), seq, summary: a.summary, tokensIn: a.tokens?.in, tokensOut: a.tokens?.out, startedAt: now() },
        ...scoped(c),
      })
      return { step: step.id, seq, leaseExpiresAt }
    },
  },
  {
    name: 'attach_evidence',
    access: 'agent',
    description: 'Append markdown to the Run\'s ## Evidence (commands with exit codes, test summary, lint diff, links).',
    inputSchema: obj({ ...runId, ...leaseToken, markdown: str('Evidence to append') }, ['runId', 'leaseToken', 'markdown']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken, sql`"evidence" = concat_ws(E'\n\n', NULLIF("evidence", ''), ${a.markdown}::text), ${U}`)
      return { ok: true, leaseExpiresAt }
    },
  },
  {
    name: 'submit_plan',
    access: 'agent',
    description: 'Post or update the Ticket\'s plan comment (one per Ticket, marked <!-- bauherr:plan -->) Plan Runs only.',
    inputSchema: obj({ ...runId, ...leaseToken, markdown: str('Full plan markdown') }, ['runId', 'leaseToken', 'markdown']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      if (run.stage !== 'plan') throw new Error(`run ${run.id} is a ${run.stage} Run, not a plan Run`)
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken)
      return { ...(await submitPlan(c.payload, c.user, { ticket: id(run.ticket), markdown: a.markdown })), leaseExpiresAt }
    },
  },
  {
    name: 'submit_investigation',
    access: 'agent',
    description: 'Investigation Plan Runs only (a Run on a Ticket whose Build failed twice; read the <!-- bauherr:investigation --> Comment first). Records the cause and one decision in the Ticket\'s investigation Comment. revise: the plan was wrong, then post a revised plan with submit_plan. fix-ticket: the cause is in the factory or repo; files a type:bug Ticket (fix.title, fix.body) and sets it blocked-by, Build restarts by itself once it is closed. needs-human: ask the owner a concrete question, then finish_run needs_human. Call once.',
    inputSchema: obj(
      {
        ...runId,
        ...leaseToken,
        cause: str('The named cause of both failures'),
        decision: { enum: ['revise', 'fix-ticket', 'needs-human'] },
        fix: { type: 'object', description: 'fix-ticket only', properties: { title: str('Title of the fix Ticket'), body: str('Body of the fix Ticket') }, required: ['title'] },
        question: str('needs-human only: the concrete question'),
        model: str('The model you ran on, for the escalation line'),
      },
      ['runId', 'leaseToken', 'cause', 'decision'],
    ),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      if (!run.investigation) throw new Error(`run ${run.id} is not an investigation Run`)
      if ((run.artifacts as { investigation?: unknown } | null)?.investigation) throw new Error('the investigation was already submitted')
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken)
      return { ...(await submitInvestigation(c.payload, run, a as InvestigationInput)), leaseExpiresAt }
    },
  },
  {
    name: 'request_review',
    access: 'agent',
    description: 'Move the Ticket to the review stage label. Refused with the failing lines when the Product\'s pre-review checks fail (run_checks shows them first). Review only green heads: with red required checks on the MR head it answers {refused, checks} and stays in Build (fix, push, ask again); with pending checks it answers {waiting: "checks"} and the factory moves the Ticket to Review when they are green.',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken)
      return { ...(await requestReview(c.payload, c.user, { ticket: id(run.ticket), evidence: run.evidence ?? '' })), leaseExpiresAt }
    },
  },
  {
    name: 'run_checks',
    access: 'agent',
    description: 'The Product\'s pre-review checks against the Ticket\'s open MR and the Run\'s Evidence so far: {failures: []} means request_review passes them. Other scorecard rules are listed with result unknown.',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      const leaseExpiresAt = await renewLease(c, run, a.leaseToken)
      const failures = await preReviewFailures(c.payload, await getTicket(c, id(run.ticket)), run.evidence ?? '')
      return { failures, rules: walk(PACK()).filter((f) => f.startsWith('rules/')).map((rule) => ({ rule, result: 'unknown' })), leaseExpiresAt }
    },
  },
  {
    name: 'finish_run',
    access: 'agent',
    description: 'End your session Run. Exit rule: succeeded needs an MR (prUrl) or the stage output; otherwise failed or needs_human with a reason. reasonKind says why you stopped: decision (a product question for the owner), access (a credential, repo setting or permission) or stuck (anything else; the factory then retries on a stronger model). It is required with needs_human; a missing value counts as decision. A Build whose MR head has red required checks is refused (fix and push); pending checks leave the Ticket in Build, waiting for checks, and the factory moves it to Review once they are green.',
    inputSchema: obj({ ...runId, ...leaseToken, status: { enum: ['succeeded', 'failed', 'needs_human'] }, reason: str('Required unless succeeded'), reasonKind: { enum: ['decision', 'access', 'stuck'], description: 'Why the Run stopped, see the tool description' }, prUrl: str('MR/PR URL, linked on the Ticket') }, ['runId', 'leaseToken', 'status']),
    async run(a, c) {
      if (!['succeeded', 'failed', 'needs_human'].includes(a.status)) throw new Error('status must be succeeded|failed|needs_human')
      if (a.status !== 'succeeded' && !a.reason) throw new Error('reason is required unless succeeded')
      if (a.reasonKind !== undefined && !['decision', 'access', 'stuck'].includes(a.reasonKind)) throw new Error('reasonKind must be decision|access|stuck')
      const defaulted = a.status === 'needs_human' && !a.reasonKind
      const reasonKind = a.status === 'succeeded' ? null : (a.reasonKind ?? (a.status === 'needs_human' ? 'decision' : null))
      const run = await getRun(c, a.runId, a)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c.payload, ticket)
      if (a.prUrl) {
        await assertOpenFactoryMr(c.payload, ticket, a.prUrl)
        await ts.addLink(n, a.prUrl)
      }
      if (a.status === 'needs_human') await ts.comment(n, `Bauherr needs a human: ${a.reason}`)
      if (a.status === 'succeeded' && a.prUrl && run.stage === 'build') {
        const asked = await requestReview(c.payload, c.user, { ticket: id(run.ticket), evidence: run.evidence ?? '' })
        if ('refused' in asked) throw new Error(`${asked.refused}: fix them on the MR, push, run the required checks, then finish again`)
      }
      await ownerWrite(
        c,
        run,
        a.leaseToken,
        sql`"status" = ${a.status}, "error" = ${a.status === 'succeeded' ? null : a.reason}, "reason_kind" = ${reasonKind}::"enum_runs_reason_kind", "finished_at" = now(), "artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify(a.prUrl ? { prUrl: a.prUrl } : {})}::jsonb, ${U}`,
      )
      if (run.stage === 'build' && a.status === 'succeeded' && a.prUrl) await startReviewIfReady(c.payload, await getTicket(c, id(run.ticket)))
      return { status: a.status, ...(defaulted && { note: 'reasonKind was missing: treated as decision, so the owner gets this. Pass stuck when a stronger model could solve it.' }) }
    },
  },
  {
    name: 'relink_mr',
    access: 'agent',
    description: 'Build Runs only: link the Ticket to a replacement MR you opened by hand (the earlier one was closed). prUrl must be an open pull request in the Ticket repo from a branch named bauherr/<ticket number>-... (not a fork). The review then runs on that MR.',
    inputSchema: obj({ ...runId, ...leaseToken, prUrl: str('URL of the open replacement MR') }, ['runId', 'leaseToken', 'prUrl']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      if (run.stage !== 'build') throw new Error('relink_mr is for Build Runs')
      const ticket = await getTicket(c, id(run.ticket))
      await assertOpenFactoryMr(c.payload, ticket, a.prUrl)
      const leaseExpiresAt = await ownerWrite(c, run, a.leaseToken, sql`"artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify({ prUrl: a.prUrl })}::jsonb, ${U}`)
      return { linked: a.prUrl, leaseExpiresAt }
    },
  },
  {
    name: 'submit_review',
    access: 'agent',
    description: 'End your Review Run with the verdict. findings: [{severity: high|medium|low, file, line, msg, scenario}]; markdown is posted as the MR review comment. Any high or medium finding makes the verdict changes (Ticket goes back to Build); clean + green checks + ## Evidence merges the MR. Include checked (one justification per area, each note 1-1000 characters; a longer or empty note is refused with an error: shorten it and call again). A verdict that contradicts the findings, or a missing area, sends the Ticket to a human. Never edit code in a Review Run.',
    inputSchema: obj(
      {
        ...runId,
        ...leaseToken,
        verdict: { enum: ['clean', 'changes'] },
        findings: {
          type: 'array',
          maxItems: 50,
          items: { type: 'object', properties: { severity: { enum: ['high', 'medium', 'low'] }, file: { type: 'string', pattern: FILE_PATTERN }, line: { type: 'integer', minimum: 0 }, msg: { type: 'string', maxLength: 1000 }, scenario: { type: 'string', maxLength: 1000 } }, required: ['severity', 'file', 'line', 'msg', 'scenario'] },
        },
        checked: { type: 'array', description: 'One entry per area: correctness, over-engineering, spec-vs-plan, evidence. A review without all four goes to a human.', items: { type: 'object', properties: { area: { enum: ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'] }, note: { type: 'string', maxLength: 1000, description: 'One-line justification' } }, required: ['area', 'note'] } },
        markdown: { type: 'string', maxLength: 60000, description: 'Review comment: verdict, findings, Open (low findings)' },
      },
      ['runId', 'leaseToken', 'verdict', 'findings', 'checked', 'markdown'],
    ),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      if (run.stage !== 'review') throw new Error(`run ${run.id} is a ${run.stage} Run, not a review Run`)
      const review = normalizeReview(a)
      const reviewedSha = (await prOf(c.payload, await getTicket(c, id(run.ticket))))?.pr.headSha ?? null
      await ownerWrite(
        c,
        run,
        a.leaseToken,
        sql`"status" = 'succeeded', "error" = NULL, "finished_at" = now(), "verdict" = ${review.verdict}, "findings" = ${JSON.stringify(review.findings)}::jsonb, "reviewed_sha" = ${reviewedSha}, "artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify({ review: { markdown: review.markdown, ...(review.problem && { problem: review.problem }) } })}::jsonb, ${U}`,
      )
      return { verdict: review.verdict, ...(await concludeReview(c.payload, id(run.ticket), review, reviewedSha)) }
    },
  },
  {
    name: 'submit_triage',
    access: 'agent',
    description: 'End your Triage Run with the outcome. plan: the Ticket is ready (clear goal, acceptance criteria or derivable ones, no open product decision); it gets the plan stage label. refine: post questions for the owner (every one critical; title, default, alternatives) and hold the Ticket with bauherr:needs-refinement until they are answered. skip: post the reason, no stage; not re-triaged until the Ticket changes. reason is always required (one line). Never edit code in a Triage Run.',
    inputSchema: obj(
      {
        ...runId,
        ...leaseToken,
        outcome: { enum: ['plan', 'refine', 'skip'] },
        reason: str('One line'),
        expedite: { type: 'boolean', description: 'Propose the expedite lane (production down or factory blocked); the owner decides' },
        questions: { type: 'array', maxItems: 10, description: 'refine only', items: { type: 'object', properties: { title: str('The question'), default: str('Recommended answer'), alternatives: { type: 'array', maxItems: 5, items: { type: 'string' } } }, required: ['title', 'default'] } },
      },
      ['runId', 'leaseToken', 'outcome', 'reason'],
    ),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      if (run.stage !== 'triage') throw new Error(`run ${run.id} is a ${run.stage} Run, not a triage Run`)
      const triage = normalizeTriage(a)
      await ownerWrite(
        c,
        run,
        a.leaseToken,
        sql`"status" = 'succeeded', "error" = NULL, "finished_at" = now(), "artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify({ triage: { outcome: triage.outcome, reason: triage.reason } })}::jsonb, ${U}`,
      )
      return submitTriage(c.payload, id(run.ticket), triage)
    },
  },
  {
    name: 'release_run',
    access: 'agent',
    description: "Give a Run back: to the queue as awaiting_session, or with takeover 'autonomous' hand it to the Runner. Works on awaiting_session Runs and your own (leaseToken required while running).",
    inputSchema: obj({ ...runId, ...leaseToken, takeover: { enum: ['autonomous'] } }, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId)
      const mine = run.status === 'running'
      if (mine) assertLease(run, a)
      if (run.mode !== 'session' || !(run.status === 'awaiting_session' || mine)) throw new Error(`run ${run.id} is not releasable`)
      const auto = a.takeover === 'autonomous'
      const reset = sql`"session_owner_id" = NULL, "agent_key_id" = NULL, "lease_hash" = NULL, "heartbeat_at" = NULL, ${auto ? sql`"mode" = 'autonomous', "status" = 'queued'` : sql`"status" = 'awaiting_session'`}, ${U}`
      if (mine) {
        await renewLease(c, run, a.leaseToken, reset, false)
        const ticket = await getTicket(c, id(run.ticket))
        const { ts, n } = await sourceOf(c.payload, ticket)
        const login = sessionLogin(c)
        if (login && !(await ownsGate(c.payload, ticket, login))) await ts.unassign(n, [login])
      } else {
        const r = await c.payload.db.drizzle.execute(sql`UPDATE "runs" SET ${reset} WHERE "id" = ${run.id} AND "status" = 'awaiting_session' RETURNING "id"`)
        if (!r.rows.length) throw new Error(`run ${run.id} is not releasable`)
      }
      if (auto) await c.payload.jobs.queue({ task: 'run-stage', queue: 'runs', input: { runId: run.id } })
      return { status: auto ? 'queued' : 'awaiting_session' }
    },
  },
  {
    name: 'approve',
    access: 'human',
    description: 'Human only: approve the plan gate as the Bauherr (adds bauherr:approved:plan, records a human touch). Refused for agent keys.',
    inputSchema: obj({ ...ticketId, gate: { enum: ['plan'] } }, ['ticket', 'gate']),
    async run(a, c) {
      if (a.gate !== 'plan') throw new Error("gate must be 'plan'")
      await getTicket(c, a.ticket)
      return approvePlan(c.payload, c.user, a)
    },
  },
  {
    name: 'post_staging_summary',
    access: 'agent',
    description: 'Post the templated staging summary Comment on a Ticket in release (once per merge commit).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return postStagingSummary(c.payload, c.user, a)
    },
  },
  {
    name: 'accept_staging',
    access: 'human',
    description: 'Human only: accept the Ticket on staging as the Bauherr (adds bauherr:approved:staging, records a human touch, moves to done).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return acceptStaging(c.payload, c.user, a)
    },
  },
  {
    name: 'approve_production',
    access: 'human',
    description: 'Approve the production deploy of a Ticket accepted on staging, or retry after a failed one (records a human touch, then sets bauherr:approved:production as an output signal for label-triggered pipelines). Refused while a session Run holds the Ticket. The Product\'s own pipeline deploys; Bauherr observes the result.',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      const t = await getTicket(c, a.ticket)
      if ((await c.payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { mode: { equals: 'session' } }, { status: { equals: 'running' } }] }, overrideAccess: true })).totalDocs) throw new Error('a session Run holds this Ticket: production approval is for the owner, not an agent')
      return approveProduction(c.payload, c.user, a)
    },
  },
  {
    name: 'return_to_build',
    access: 'agent',
    description: 'Repair a dead Ticket: send it back to Build (on its open MR, or with a note to open a new one). Allowed only while the Ticket is dead for a mechanical cause (its MR is missing or its checks are red); refused for a live Ticket and for every decision (gates stay human-only).',
    inputSchema: obj({ ...ticketId, reason: str('Why it goes back to Build') }, ['ticket', 'reason']),
    async run(a, c) {
      const t = await getTicket(c, a.ticket)
      if (typeof a.reason !== 'string' || !a.reason.trim()) throw new Error('reason required')
      const dead = (await deadTickets(c.payload, id(t.workspace))).find((d) => d.ticket.id === t.id)
      if (!dead || !AGENT_REPAIRED.includes(dead.cause)) throw new Error(`ticket ${t.number} is not dead for a mechanical cause; nothing to repair`)
      // The agent's own words stay out of the next Run's instructions (owner-level text); the tool call keeps them in the audit digest.
      return { outcome: await sendBackToBuild(c.payload, t, `Sent back to Build by an agent: ${dead.cause === 'mr-missing' ? 'the MR was closed' : 'checks are red on the MR'}.`) }
    },
  },
  {
    name: 'grant_review_round',
    access: 'human',
    description: 'Human only: at the review round cap (once the factory grant is used), grant exactly one more round (back to Build on the same MR, records a human touch). Refused for agent keys.',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return grantReviewRound(c.payload, c.user, a)
    },
  },
  {
    name: 'stop_review',
    access: 'human',
    description: 'Human only: at the review round cap, stop: the MR stays open, the Ticket moves to triage with a note Comment. Refused for agent keys.',
    inputSchema: obj({ ...ticketId, note: str('Why it was stopped') }, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return stopReview(c.payload, c.user, a)
    },
  },
  {
    name: 'request_changes',
    access: 'human',
    description: 'Human only: send a Ticket in release back to build with a note (becomes Current instructions); starts a Build Run.',
    inputSchema: obj({ ...ticketId, note: str('What must change') }, ['ticket', 'note']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return requestChanges(c.payload, c.user, a)
    },
  },
  {
    name: 'load_skill',
    access: 'agent',
    description: 'Read a pack skill (SKILL.md) by name, e.g. run-contract, worklog.',
    inputSchema: obj({ name: str('Skill name') }, ['name']),
    async run(a) {
      if (!/^[\w-]+$/.test(a.name)) throw new Error('invalid skill name')
      return packFile(`skills/${a.name}/SKILL.md`)
    },
  },
  {
    name: 'read_knowledge',
    access: 'agent',
    description: 'Read a Knowledge document by path (e.g. rules/evidence.md): the Workspace layer shadows the core pack, the optional product layer shadows both.',
    inputSchema: obj({ path: str('Path relative to pack/ or the Knowledge repo'), product: str('Product slug whose layer applies') }, ['path']),
    async run(a, c) {
      const ws = c.workspace ?? tenantsOf(c.user)[0]
      const doc = ws !== undefined ? await knowledge.read(c.payload, ws, a.path, a.product) : null
      return doc ? (doc.source === 'core' ? doc.text : untrustedBlock(doc.text)) : packFile(a.path)
    },
  },
  {
    name: 'search_knowledge',
    access: 'agent',
    description: 'Full-text search over the core pack, the Workspace Knowledge repo and the docs of Product repos; returns up to 20 {source, path, heading, commit, text}, best first.',
    inputSchema: obj({ query: str('Words to find (quotes for phrases, - to exclude)'), product: str('Product slug whose layer applies') }, ['query']),
    async run(a, c) {
      const ws = c.workspace ?? tenantsOf(c.user)[0]
      if (ws === undefined) throw new Error('no Workspace')
      return (await knowledge.search(c.payload, ws, String(a.query), 20, a.product)).map((h) => (h.source === 'core' ? h : { ...h, source: knowledge.repoOf(h.source), text: untrustedBlock(h.text) }))
    },
  },
]

/** Input digest: argument names plus a hash; raw payloads are never stored. */
export const digest = (input: unknown): string =>
  `${Object.keys((input as object) ?? {}).join(',')} sha256:${createHash('sha256').update(JSON.stringify(input ?? {})).digest('hex').slice(0, 16)}`

/** Runs a tool and records the tool_calls row (skipped when no Workspace is known). */
export const callTool = async (c: Ctx, name: string, input: unknown): Promise<unknown> => {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`unknown tool ${name}`)
  const t0 = Date.now()
  c.tool = name
  let ok = false
  try {
    if (tool.access !== 'agent' && c.actor.kind !== 'human') throw new Error(`forbidden: ${name} needs a human; this session uses an agent key. Use the UI or ask the owner.`)
    const out = await tool.run(input ?? {}, c)
    ok = true
    return out
  } finally {
    const workspace = c.workspace ?? tenantsOf(c.user)[0]
    if (workspace !== undefined) {
      await c.payload.create({
        collection: 'tool_calls',
        data: { workspace, run: c.run, name, inputDigest: digest(input), status: ok ? 'ok' : 'error', agentKey: c.actor.kind === 'agent' ? c.actor.keyId : undefined, durationMs: Date.now() - t0 },
        overrideAccess: true,
      })
    }
  }
}
