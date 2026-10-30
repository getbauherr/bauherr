import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { acceptStaging, approvePlan, postStagingSummary, readWorklog, requestChanges, requestReview, scoped as scopedUser, sourceOf, tenantsOf, updateWorklog } from './actions'
import { SESSION_TIMEOUT_MS } from '../jobs'
import { goalOf } from './run-ctx'

type Doc = Record<string, any>
export interface Ctx {
  payload: Payload
  user: Doc
  /** Set by handlers once a Run or Ticket is loaded; used for the tool_calls row. */
  workspace?: number | string
  run?: number | string
}
export interface Tool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
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

export const tools: Tool[] = [
  {
    name: 'list_frontier',
    description: 'Open, unblocked Tickets with stage and latest Run state. Only claim Tickets with claimable=true; leased ones show leasedBy + leaseExpiresAt: never touch their branch or worktree.',
    inputSchema: obj({ product: str('Product slug') }),
    async run(a, c) {
      const product = a.product
        ? (await c.payload.find({ collection: 'products', where: { slug: { equals: a.product } }, limit: 1, ...scoped(c) })).docs[0]
        : null
      if (a.product && !product) return []
      const tickets = await c.payload.find({
        collection: 'tickets',
        where: { and: [{ state: { equals: 'open' } }, ...(product ? [{ product: { equals: product.id } }] : [])] },
        limit: 100,
        ...scoped(c),
        depth: 1,
      })
      const open = tickets.docs.filter((t: Doc) => !((t.blockedBy as Doc[]) ?? []).some((b) => b.state === 'open'))
      const runs = await c.payload.find({
        collection: 'runs',
        where: { ticket: { in: open.map((t) => t.id) } },
        sort: '-createdAt',
        limit: 500,
        ...scoped(c),
      })
      const latest = new Map<unknown, Doc>()
      for (const r of runs.docs as Doc[]) if (!latest.has(id(r.ticket))) latest.set(id(r.ticket), r)
      const leases = [...latest.values()].filter((r) => r.status === 'running' && r.mode === 'session')
      const owners = new Map<unknown, string>(
        (await c.payload.find({ collection: 'bauherren', where: { id: { in: leases.map((r) => id(r.sessionOwner)) } }, limit: 100, depth: 0, overrideAccess: true })).docs.map((u: Doc) => [u.id, u.name ?? u.email]),
      )
      return open.map((t: Doc) => {
        const r = latest.get(t.id)
        return {
          ticket: t.id, number: t.number, title: t.title, url: t.url, stage: t.stage, labels: t.labels, assignee: t.assignee,
          run: r ? { id: r.id, stage: r.stage, status: r.status, mode: r.mode } : null,
          claimable: r?.mode === 'session' && r.status === 'awaiting_session',
          ...(leases.includes(r as Doc) && { leasedBy: owners.get(id(r!.sessionOwner)) ?? null, leaseExpiresAt: new Date(new Date(r!.heartbeatAt).getTime() + SESSION_TIMEOUT_MS).toISOString() }),
        }
      })
    },
  },
  {
    name: 'get_ticket',
    description: 'Ticket pointer plus live body and Goal statements.',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      const t = await getTicket(c, a.ticket)
      const { ts, n } = await sourceOf(c.payload, t)
      const live = await ts.get(n)
      return { ...t, body: live.body, goal: goalOf(live.body) }
    },
  },
  {
    name: 'claim_run',
    description: 'Claim an awaiting_session Run: status running, Ticket assigned. Returns the leaseToken (shown once): every later call on the Run needs it, hand it to subagents.',
    inputSchema: obj(runId, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId)
      if (run.mode !== 'session' || run.status !== 'awaiting_session') throw new Error(`run ${run.id} is ${run.mode}/${run.status}, not awaiting_session`)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c.payload, ticket)
      const body = (await ts.get(n)).body
      const leaseToken = randomBytes(32).toString('base64url')
      // Single conditional UPDATE (goal included): Payload's update-by-where is find-then-update and lets two claimers both win.
      const claimed = await c.payload.db.drizzle.execute(
        sql`UPDATE "runs" SET "status" = 'running', "session_owner_id" = ${c.user.id}, "lease_hash" = ${sha256(leaseToken)}, "heartbeat_at" = now(), "started_at" = now(), "goal" = ${JSON.stringify({ statements: goalOf(body) })}::jsonb, ${U} WHERE "id" = ${run.id} AND "workspace_id" = ${id(run.workspace)} AND "status" = 'awaiting_session' RETURNING "id"`,
      )
      if (!claimed.rows.length) throw new Error(`run ${run.id} was claimed by someone else`)
      const won = await c.payload.findByID({ collection: 'runs', id: run.id, ...scoped(c) })
      const login = (c.user.githubLogin as string | undefined) ?? process.env.BAUHERR_BOT_LOGIN
      if (login) {
        try {
          await ts.claim(n, login)
        } catch (e) {
          await c.payload.update({ collection: 'runs', id: run.id, data: { status: 'awaiting_session', sessionOwner: null, leaseHash: null, heartbeatAt: null }, overrideAccess: true })
          throw e
        }
      }
      return { run: won, leaseToken, ticket: { id: ticket.id, number: ticket.number, url: ticket.url, title: ticket.title, body }, goal: goalOf(body), assignedTo: login ?? null }
    },
  },
  {
    name: 'heartbeat',
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
    description: 'Markdown of the Ticket\'s factory worklog comment (empty if none).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return readWorklog(c.payload, c.user, a)
    },
  },
  {
    name: 'update_worklog',
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
    description: 'Append markdown to the Run\'s ## Evidence (commands with exit codes, test summary, lint diff, links).',
    inputSchema: obj({ ...runId, ...leaseToken, markdown: str('Evidence to append') }, ['runId', 'leaseToken', 'markdown']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      await ownerWrite(c, run, a.leaseToken, sql`"evidence" = concat_ws(E'\n\n', NULLIF("evidence", ''), ${a.markdown}::text), ${U}`)
      return { ok: true }
    },
  },
  {
    name: 'request_review',
    description: 'Move the Ticket to the review stage label.',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      const run = await getRun(c, a.runId, a)
      return requestReview(c.payload, c.user, { ticket: id(run.ticket) })
    },
  },
  {
    name: 'run_checks',
    description: 'Scorecard rules for the Run (placeholder: every result is unknown).',
    inputSchema: obj({ ...runId, ...leaseToken }, ['runId', 'leaseToken']),
    async run(a, c) {
      await getRun(c, a.runId, a)
      return walk(PACK()).filter((f) => f.startsWith('rules/')).map((rule) => ({ rule, result: 'unknown' }))
    },
  },
  {
    name: 'finish_run',
    description: 'End your session Run. Exit rule: succeeded needs an MR (prUrl) or the stage output; otherwise failed or needs_human with a reason.',
    inputSchema: obj({ ...runId, ...leaseToken, status: { enum: ['succeeded', 'failed', 'needs_human'] }, reason: str('Required unless succeeded'), prUrl: str('MR/PR URL, linked on the Ticket') }, ['runId', 'leaseToken', 'status']),
    async run(a, c) {
      if (!['succeeded', 'failed', 'needs_human'].includes(a.status)) throw new Error('status must be succeeded|failed|needs_human')
      if (a.status !== 'succeeded' && !a.reason) throw new Error('reason is required unless succeeded')
      const run = await getRun(c, a.runId, a)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c.payload, ticket)
      if (a.prUrl) await ts.addLink(n, a.prUrl)
      if (a.status === 'needs_human') await ts.comment(n, `Bauherr needs a human: ${a.reason}`)
      await ownerWrite(
        c,
        run,
        a.leaseToken,
        sql`"status" = ${a.status}, "error" = ${a.status === 'succeeded' ? null : a.reason}, "finished_at" = now(), "artifacts" = COALESCE("artifacts", '{}'::jsonb) || ${JSON.stringify(a.prUrl ? { prUrl: a.prUrl } : {})}::jsonb, ${U}`,
      )
      return { status: a.status }
    },
  },
  {
    name: 'release_run',
    description: "Give a Run back: to the queue as awaiting_session, or with takeover 'autonomous' hand it to the Runner. Works on awaiting_session Runs and your own (leaseToken required while running).",
    inputSchema: obj({ ...runId, ...leaseToken, takeover: { enum: ['autonomous'] } }, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId)
      const mine = run.status === 'running'
      if (mine) assertLease(run, a)
      if (run.mode !== 'session' || !(run.status === 'awaiting_session' || mine)) throw new Error(`run ${run.id} is not releasable`)
      const auto = a.takeover === 'autonomous'
      const reset = sql`"session_owner_id" = NULL, "lease_hash" = NULL, "heartbeat_at" = NULL, ${auto ? sql`"mode" = 'autonomous', "status" = 'queued'` : sql`"status" = 'awaiting_session'`}, ${U}`
      if (mine) {
        await ownerWrite(c, run, a.leaseToken, reset)
        const { ts, n } = await sourceOf(c.payload, await getTicket(c, id(run.ticket)))
        await ts.release(n)
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
    description: 'Approve the plan gate as the Bauherr (adds bauherr:approved:plan, records a human touch). The only way to approve.',
    inputSchema: obj({ ...ticketId, gate: { enum: ['plan'] } }, ['ticket', 'gate']),
    async run(a, c) {
      if (a.gate !== 'plan') throw new Error("gate must be 'plan'")
      await getTicket(c, a.ticket)
      return approvePlan(c.payload, c.user, a)
    },
  },
  {
    name: 'post_staging_summary',
    description: 'Post the templated staging summary Comment on a Ticket in release (once per merge commit).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return postStagingSummary(c.payload, c.user, a)
    },
  },
  {
    name: 'accept_staging',
    description: 'Accept the Ticket on staging as the Bauherr (adds bauherr:approved:staging, records a human touch, moves to done).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return acceptStaging(c.payload, c.user, a)
    },
  },
  {
    name: 'request_changes',
    description: 'Send a Ticket in release back to build with a note (becomes Current instructions); starts a Build Run.',
    inputSchema: obj({ ...ticketId, note: str('What must change') }, ['ticket', 'note']),
    async run(a, c) {
      await getTicket(c, a.ticket)
      return requestChanges(c.payload, c.user, a)
    },
  },
  {
    name: 'load_skill',
    description: 'Read a pack skill (SKILL.md) by name, e.g. run-contract, worklog.',
    inputSchema: obj({ name: str('Skill name') }, ['name']),
    async run(a) {
      if (!/^[\w-]+$/.test(a.name)) throw new Error('invalid skill name')
      return packFile(`skills/${a.name}/SKILL.md`)
    },
  },
  {
    name: 'read_knowledge',
    description: 'Read a file of the core pack by path relative to pack/ (e.g. rules/evidence.md).',
    inputSchema: obj({ path: str('Path relative to pack/') }, ['path']),
    async run(a) {
      return packFile(a.path)
    },
  },
  {
    name: 'search_knowledge',
    description: 'Case-insensitive substring search over the core pack; returns up to 20 {path, line, text}.',
    inputSchema: obj({ query: str('Text to find') }, ['query']),
    async run(a) {
      const q = String(a.query).toLowerCase()
      const hits: { path: string; line: number; text: string }[] = []
      for (const path of walk(PACK())) {
        packFile(path).split('\n').forEach((text, i) => {
          if (hits.length < 20 && text.toLowerCase().includes(q)) hits.push({ path, line: i + 1, text: text.trim().slice(0, 200) })
        })
      }
      return hits
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
    const out = await tool.run(input ?? {}, c)
    ok = true
    return out
  } finally {
    const workspace = c.workspace ?? tenantsOf(c.user)[0]
    if (workspace !== undefined) {
      await c.payload.create({
        collection: 'tool_calls',
        data: { workspace, run: c.run, name, inputDigest: digest(input), status: ok ? 'ok' : 'error', durationMs: Date.now() - t0 },
        overrideAccess: true,
      })
    }
  }
}
