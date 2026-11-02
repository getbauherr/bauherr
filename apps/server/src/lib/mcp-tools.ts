import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { FILE_PATTERN, acceptStaging, approvePlan, approveProduction, concludeReview, grantReviewRound, stopReview, normalizeReview, normalizeTriage, postStagingSummary, readWorklog, requestChanges, requestReview, scoped as scopedUser, sourceOf, submitPlan, submitTriage, tenantsOf, updateWorklog } from './actions'
import { SESSION_TIMEOUT_MS, startReviewIfReady } from '../jobs'
import { forgeOf, isFactoryPr, prNumber, prOf } from './release'
import { ownsGate } from './gates'
import { frontierOrder } from './frontier'
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

/** Applies `set` to the Run only while it is still running, holds `token` and its heartbeat is fresh (one conditional UPDATE); else `lease lost`. */
const ownerWrite = async (c: Ctx, run: Doc, token: unknown, set: ReturnType<typeof sql>): Promise<void> => {
  const r = await c.payload.db.drizzle.execute(
    sql`UPDATE "runs" SET ${set} WHERE "id" = ${run.id} AND "status" = 'running' AND "lease_hash" = ${sha256(String(token))} AND "heartbeat_at" > now() - make_interval(secs => ${SESSION_TIMEOUT_MS / 1000}) RETURNING "id"`,
  )
  if (!r.rows.length) throw new Error(`lease lost: run ${run.id}`)
}

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
const ticketId = { ticket: { type: ['number', 'string'], description: 'Ticket id (Bauherr database id)' } }

class ClaimLost extends Error {}

/** The GitHub login a session Run assigns on the Ticket. */
const sessionLogin = (c: Ctx): string | undefined => (c.user.githubLogin as string | undefined) ?? process.env.BAUHERR_BOT_LOGIN

/** Claims an awaiting_session Run for the caller and returns the `claim_run` payload; `ClaimLost` when another claimer won. */
const claimRun = async (c: Ctx, runId: number | string) => {
  const run = await getRun(c, runId)
  const notClaimable = `run ${run.id} is ${run.mode}/${run.status}, not awaiting_session`
  if (run.mode !== 'session') throw new Error(notClaimable)
  if (run.status !== 'awaiting_session') throw new ClaimLost(notClaimable)
  const ticket = await getTicket(c, id(run.ticket))
  const { ts, n } = await sourceOf(c.payload, ticket)
  const body = (await ts.get(n)).body
  const statements = await goalFor(c.payload, ticket, body, run.stage)
  const leaseToken = randomBytes(32).toString('base64url')
  // Single conditional UPDATE (goal included): Payload's update-by-where is find-then-update and lets two claimers both win.
  const claimed = await c.payload.db.drizzle.execute(
    sql`UPDATE "runs" SET "status" = 'running', "session_owner_id" = ${c.user.id}, "agent_key_id" = ${c.actor.kind === 'agent' ? c.actor.keyId : null}, "lease_hash" = ${sha256(leaseToken)}, "heartbeat_at" = now(), "started_at" = now(), "goal" = ${JSON.stringify({ statements })}::jsonb, ${U} WHERE "id" = ${run.id} AND "workspace_id" = ${id(run.workspace)} AND "status" = 'awaiting_session' RETURNING "id"`,
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
  return { run: won, leaseToken, ticket: { id: ticket.id, number: ticket.number, url: ticket.url, ...shown }, goal: run.stage === 'triage' ? [untrustedBlock(statements.map((s) => `- ${s}`).join('\n'))] : statements, assignedTo: login ?? null }
}

/** Open, unblocked Tickets in frontier order with their latest Run. */
const frontier = async (c: Ctx, productSlug?: string): Promise<{ open: Doc[]; latest: Map<unknown, Doc> } | null> => {
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
  const unblocked = tickets.docs.filter((t: Doc) => !((t.blockedBy as Doc[]) ?? []).some((b) => b.state === 'open'))
  const runs = await c.payload.find({
    collection: 'runs',
    where: { ticket: { in: unblocked.map((t) => t.id) } },
    sort: '-createdAt',
    pagination: false,
    ...scoped(c),
  })
  const latest = new Map<unknown, Doc>()
  for (const r of runs.docs as Doc[]) if (!latest.has(id(r.ticket))) latest.set(id(r.ticket), r)
  return { open: frontierOrder(unblocked as Doc[] as (Doc & { id: number; number: number })[], latest as Map<number, Doc & { stage: string; status: string }>), latest }
}

const isClaimable = (r?: Doc): boolean => r?.mode === 'session' && r.status === 'awaiting_session'

export const tools: Tool[] = [
  {
    name: 'list_frontier',
    access: 'agent',
    description: 'Open, unblocked Tickets with stage and latest Run state. Only claim Tickets with claimable=true; leased ones show leasedBy + leaseExpiresAt: never touch their branch or worktree.',
    inputSchema: obj({ product: str('Product slug') }),
    async run(a, c) {
      const f = await frontier(c, a.product)
      if (!f) return []
      const { open, latest } = f
      const leases = [...latest.values()].filter((r) => r.status === 'running' && r.mode === 'session')
      const owners = new Map<unknown, string>(
        (await c.payload.find({ collection: 'bauherren', where: { id: { in: leases.map((r) => id(r.sessionOwner)) } }, limit: 100, depth: 0, overrideAccess: true })).docs.map((u: Doc) => [u.id, u.name ?? u.email]),
      )
      return open.map((t: Doc) => {
        const r = latest.get(t.id)
        return {
          ticket: t.id, number: t.number, title: t.title, url: t.url, stage: t.stage, labels: t.labels, assignee: t.assignee,
          run: r ? { id: r.id, stage: r.stage, status: r.status, mode: r.mode } : null,
          claimable: isClaimable(r),
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
    description: 'Claim an awaiting_session Run: status running, Ticket assigned. Returns the leaseToken (shown once): every later call on the Run needs it, hand it to subagents.',
    inputSchema: obj(runId, ['runId']),
    async run(a, c) {
      return claimRun(c, a.runId)
    },
  },
  {
    name: 'claim_next',
    access: 'agent',
    description: 'Claim the top claimable Run in frontier order (in-flight work first, then the owner\'s Board rank; blocked and leased Tickets are skipped). Same payload as claim_run, or null when nothing is claimable. Two sessions calling at once get different Runs.',
    inputSchema: obj({ product: str('Product slug') }),
    async run(a, c) {
      const f = await frontier(c, a.product)
      for (const t of f?.open ?? []) {
        const r = f!.latest.get(t.id)
        if (!isClaimable(r)) continue
        try {
          return await claimRun(c, r!.id)
        } catch (e) {
          if (!(e instanceof ClaimLost)) throw e
        }
      }
      return null
    },
  },
  {
    name: 'heartbeat',
    access: 'agent',
    description: 'Keep a session Run alive. Send at least every 10 minutes; 30 minutes of silence ends your lease: the Run is abandoned and a new claimable Run takes over.',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      await ownerWrite(c, run, a.leaseToken, sql`"heartbeat_at" = now(), ${U}`)
      return { ok: true }
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
      return updateWorklog(c.payload, c.user, a)
    },
  },
  {
    name: 'report_step',
    access: 'agent',
    description: 'Record a Step of your session Run.',
    inputSchema: obj({ ...runId, ...leaseToken, summary: str('What was done'), tokens: { type: 'object', properties: { in: { type: 'number' }, out: { type: 'number' } } } }, ['runId', 'leaseToken', 'summary']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      await ownerWrite(c, run, a.leaseToken, U)
      const seq = (await c.payload.count({ collection: 'steps', where: { run: { equals: run.id } }, overrideAccess: true })).totalDocs + 1
      const step = await c.payload.create({
        collection: 'steps',
        data: { run: run.id, workspace: id(run.workspace), seq, summary: a.summary, tokensIn: a.tokens?.in, tokensOut: a.tokens?.out, startedAt: now() },
        ...scoped(c),
      })
      return { step: step.id, seq }
    },
  },
  {
    name: 'attach_evidence',
    access: 'agent',
    description: 'Append markdown to the Run\'s ## Evidence (commands with exit codes, test summary, lint diff, links).',
    inputSchema: obj({ ...runId, ...leaseToken, markdown: str('Evidence to append') }, ['runId', 'leaseToken', 'markdown']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      await ownerWrite(c, run, a.leaseToken, sql`"evidence" = concat_ws(E'\n\n', NULLIF("evidence", ''), ${a.markdown}::text), ${U}`)
      return { ok: true }
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
      return submitPlan(c.payload, c.user, { ticket: id(run.ticket), markdown: a.markdown })
    },
  },
  {
    name: 'request_review',
    access: 'agent',
    description: 'Move the Ticket to the review stage label.',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      return requestReview(c.payload, c.user, { ticket: id(run.ticket) })
    },
  },
  {
    name: 'run_checks',
    access: 'agent',
    description: 'Scorecard rules for the Run (placeholder: every result is unknown).',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      await getRun(c, a.runId, a)
      return walk(PACK()).filter((f) => f.startsWith('rules/')).map((rule) => ({ rule, result: 'unknown' }))
    },
  },
  {
    name: 'finish_run',
    access: 'agent',
    description: 'End your session Run. Exit rule: succeeded needs an MR (prUrl) or the stage output; otherwise failed or needs_human with a reason.',
    inputSchema: obj({ ...runId, ...leaseToken, status: { enum: ['succeeded', 'failed', 'needs_human'] }, reason: str('Required unless succeeded'), prUrl: str('MR/PR URL, linked on the Ticket') }, ['runId', 'leaseToken', 'status']),
    async run(a, c) {
      if (!['succeeded', 'failed', 'needs_human'].includes(a.status)) throw new Error('status must be succeeded|failed|needs_human')
      if (a.status !== 'succeeded' && !a.reason) throw new Error('reason is required unless succeeded')
      const run = await getRun(c, a.runId, a)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c.payload, ticket)
      if (a.prUrl) {
        const { backend, repo, web } = await forgeOf(c.payload, id(ticket.product))
        const num = prNumber(a.prUrl, repo, web)
        const pr = num == null ? null : await backend.forge.getPullRequest(repo, num)
        if (!pr || pr.state !== 'open' || !isFactoryPr(pr, repo, ticket.number)) {
          throw new Error(`prUrl must be an open pull request in ${repo} (not a fork) from a branch named bauherr/${ticket.number}-...`)
        }
        await ts.addLink(n, a.prUrl)
      }
      if (a.status === 'needs_human') await ts.comment(n, `Bauherr needs a human: ${a.reason}`)
      if (a.status === 'succeeded' && a.prUrl && run.stage === 'build') await requestReview(c.payload, c.user, { ticket: id(run.ticket) })
      await ownerWrite(
        c,
        run,
        a.leaseToken,
        sql`"status" = ${a.status}, "error" = ${a.status === 'succeeded' ? null : a.reason}, "finished_at" = now(), "artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify(a.prUrl ? { prUrl: a.prUrl } : {})}::jsonb, ${U}`,
      )
      if (run.stage === 'build' && a.status === 'succeeded' && a.prUrl) await startReviewIfReady(c.payload, await getTicket(c, id(run.ticket)))
      return { status: a.status }
    },
  },
  {
    name: 'submit_review',
    access: 'agent',
    description: 'End your Review Run with the verdict. findings: [{severity: high|medium|low, file, line, msg, scenario}]; markdown is posted as the MR review comment. Any high or medium finding makes the verdict changes (Ticket goes back to Build); clean + green checks + ## Evidence merges the MR. Include checked (one justification per area). A verdict that contradicts the findings, or a missing area, sends the Ticket to a human. Never edit code in a Review Run.',
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
        await ownerWrite(c, run, a.leaseToken, reset)
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
    name: 'grant_review_round',
    access: 'human',
    description: 'Human only: at the review round cap, grant exactly one more round (back to Build on the same MR, records a human touch). Refused for agent keys.',
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
    description: 'Full-text search over the core pack and the Workspace Knowledge repo; returns up to 20 {source, path, heading, commit, text}, best first.',
    inputSchema: obj({ query: str('Words to find (quotes for phrases, - to exclude)'), product: str('Product slug whose layer applies') }, ['query']),
    async run(a, c) {
      const ws = c.workspace ?? tenantsOf(c.user)[0]
      if (ws === undefined) throw new Error('no Workspace')
      return (await knowledge.search(c.payload, ws, String(a.query), 20, a.product)).map((h) => (h.source === 'core' ? h : { ...h, text: untrustedBlock(h.text) }))
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
