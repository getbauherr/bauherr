import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { APPROVED_PLAN, setStage } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { connectionInput } from '../jobs'
import { githubFor } from './adapters'
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
const WORKLOG_MARKER = '<!-- bauherr:worklog -->'
const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const now = () => new Date().toISOString()

/** Workspace ids of a Bauherr's tenants. */
export const tenantsOf = (user: Doc): (number | string)[] => ((user.tenants as { tenant: unknown }[]) ?? []).map((t) => id(t.tenant))

const scoped = (c: Ctx) => ({ user: c.user as never, overrideAccess: false, depth: 0 }) as const

const getRun = async (c: Ctx, runId: number | string, own = false): Promise<Doc> => {
  const run = (await c.payload.findByID({ collection: 'runs', id: runId, ...scoped(c) })) as Doc
  c.workspace = id(run.workspace)
  c.run = run.id
  if (own && (run.status !== 'running' || run.mode !== 'session' || id(run.sessionOwner) !== c.user.id)) {
    throw new Error(`run ${runId} is not a running session Run owned by you`)
  }
  return run
}

const getTicket = async (c: Ctx, ticketId: number | string): Promise<Doc> => {
  const t = (await c.payload.findByID({ collection: 'tickets', id: ticketId, ...scoped(c) })) as Doc
  c.workspace = id(t.workspace)
  return t
}

/** Ticket source for a Ticket's Product, authenticated with the Workspace's github Connection. */
const sourceOf = async (c: Ctx, ticket: Doc) => {
  const src = (
    await c.payload.find({ collection: 'ticket_sources', where: { product: { equals: id(ticket.product) } }, limit: 1, depth: 0, overrideAccess: true })
  ).docs[0]
  if (!src) throw new Error('no ticket source for this Product')
  return { ts: githubFor(await connectionInput(c.payload, src.connection)).tickets(src.repo), n: String(ticket.number) }
}

const worklogComment = async (ts: Awaited<ReturnType<typeof sourceOf>>['ts'], n: string) =>
  (await ts.listComments(n)).find((m) => m.body.startsWith(WORKLOG_MARKER))

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
const ticketId = { ticket: { type: ['number', 'string'], description: 'Ticket id (Bauherr database id)' } }

export const tools: Tool[] = [
  {
    name: 'list_frontier',
    description: 'Open, unblocked Tickets with stage and latest Run state (awaiting_session = ready to claim).',
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
      return open.map((t: Doc) => {
        const r = latest.get(t.id)
        return {
          ticket: t.id, number: t.number, title: t.title, url: t.url, stage: t.stage, labels: t.labels, assignee: t.assignee,
          run: r ? { id: r.id, stage: r.stage, status: r.status, mode: r.mode } : null,
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
      const { ts, n } = await sourceOf(c, t)
      const live = await ts.get(n)
      return { ...t, body: live.body, goal: goalOf(live.body) }
    },
  },
  {
    name: 'claim_run',
    description: 'Claim an awaiting_session Run: you become sessionOwner, status running, Ticket assigned.',
    inputSchema: obj(runId, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId)
      if (run.mode !== 'session' || run.status !== 'awaiting_session') throw new Error(`run ${run.id} is ${run.mode}/${run.status}, not awaiting_session`)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c, ticket)
      const body = (await ts.get(n)).body
      const won = await c.payload.update({
        collection: 'runs',
        where: { and: [{ id: { equals: run.id } }, { status: { equals: 'awaiting_session' } }] },
        data: { status: 'running', sessionOwner: c.user.id, heartbeatAt: now(), startedAt: now(), goal: { statements: goalOf(body) } },
        ...scoped(c),
      })
      if (!won.docs.length) throw new Error(`run ${run.id} was claimed by someone else`)
      const login = (c.user.githubLogin as string | undefined) ?? process.env.BAUHERR_BOT_LOGIN
      if (login) {
        try {
          await ts.claim(n, login)
        } catch (e) {
          await c.payload.update({ collection: 'runs', id: run.id, data: { status: 'awaiting_session', sessionOwner: null, heartbeatAt: null }, overrideAccess: true })
          throw e
        }
      }
      return { run: won.docs[0], ticket: { id: ticket.id, number: ticket.number, url: ticket.url, title: ticket.title, body }, goal: goalOf(body), assignedTo: login ?? null }
    },
  },
  {
    name: 'heartbeat',
    description: 'Keep a session Run alive. Send at least every 10 minutes; 30 minutes of silence ends it as needs_human.',
    inputSchema: obj(runId, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId, true)
      await c.payload.update({ collection: 'runs', id: run.id, data: { heartbeatAt: now() }, ...scoped(c) })
      return { ok: true }
    },
  },
  {
    name: 'read_worklog',
    description: 'Markdown of the Ticket\'s factory worklog comment (empty if none).',
    inputSchema: obj(ticketId, ['ticket']),
    async run(a, c) {
      const { ts, n } = await sourceOf(c, await getTicket(c, a.ticket))
      return (await worklogComment(ts, n))?.body.slice(WORKLOG_MARKER.length).trimStart() ?? ''
    },
  },
  {
    name: 'update_worklog',
    description: 'Create or replace the Ticket\'s worklog comment (one per Ticket, marked <!-- bauherr:worklog -->).',
    inputSchema: obj({ ...ticketId, markdown: str('Full worklog, see the worklog skill template') }, ['ticket', 'markdown']),
    async run(a, c) {
      const { ts, n } = await sourceOf(c, await getTicket(c, a.ticket))
      const body = `${WORKLOG_MARKER}\n${a.markdown}`
      const existing = await worklogComment(ts, n)
      const saved = existing ? await ts.updateComment(n, existing.id, body) : await ts.comment(n, body)
      return { commentId: saved.id, created: !existing }
    },
  },
  {
    name: 'report_step',
    description: 'Record a Step of your session Run.',
    inputSchema: obj({ ...runId, summary: str('What was done'), tokens: { type: 'object', properties: { in: { type: 'number' }, out: { type: 'number' } } } }, ['runId', 'summary']),
    async run(a, c) {
      const run = await getRun(c, a.runId, true)
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
    inputSchema: obj({ ...runId, markdown: str('Evidence to append') }, ['runId', 'markdown']),
    async run(a, c) {
      const run = await getRun(c, a.runId, true)
      await c.payload.update({ collection: 'runs', id: run.id, data: { evidence: [run.evidence, a.markdown].filter(Boolean).join('\n\n') }, ...scoped(c) })
      return { ok: true }
    },
  },
  {
    name: 'request_review',
    description: 'Move the Ticket to the review stage label.',
    inputSchema: obj(runId, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId, true)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c, ticket)
      await setStage(ts, n, 'review')
      await c.payload.update({ collection: 'tickets', id: ticket.id, data: { stage: 'review' }, overrideAccess: true })
      return { stage: 'review' }
    },
  },
  {
    name: 'run_checks',
    description: 'Scorecard rules for the Run (placeholder: every result is unknown).',
    inputSchema: obj(runId, ['runId']),
    async run(a, c) {
      await getRun(c, a.runId, true)
      return walk(PACK()).filter((f) => f.startsWith('rules/')).map((rule) => ({ rule, result: 'unknown' }))
    },
  },
  {
    name: 'finish_run',
    description: 'End your session Run. Exit rule: succeeded needs an MR (prUrl) or the stage output; otherwise failed or needs_human with a reason.',
    inputSchema: obj({ ...runId, status: { enum: ['succeeded', 'failed', 'needs_human'] }, reason: str('Required unless succeeded'), prUrl: str('MR/PR URL, linked on the Ticket') }, ['runId', 'status']),
    async run(a, c) {
      if (!['succeeded', 'failed', 'needs_human'].includes(a.status)) throw new Error('status must be succeeded|failed|needs_human')
      if (a.status !== 'succeeded' && !a.reason) throw new Error('reason is required unless succeeded')
      const run = await getRun(c, a.runId, true)
      const ticket = await getTicket(c, id(run.ticket))
      const { ts, n } = await sourceOf(c, ticket)
      if (a.prUrl) await ts.addLink(n, a.prUrl)
      if (a.status === 'needs_human') await ts.comment(n, `Bauherr needs a human: ${a.reason}`)
      await c.payload.update({
        collection: 'runs',
        id: run.id,
        data: { status: a.status, error: a.status === 'succeeded' ? null : a.reason, finishedAt: now(), artifacts: { ...(run.artifacts ?? {}), ...(a.prUrl ? { prUrl: a.prUrl } : {}) } },
        ...scoped(c),
      })
      return { status: a.status }
    },
  },
  {
    name: 'release_run',
    description: "Give a Run back: to the queue as awaiting_session, or with takeover 'autonomous' hand it to the Runner. Works on awaiting_session Runs and your own.",
    inputSchema: obj({ ...runId, takeover: { enum: ['autonomous'] } }, ['runId']),
    async run(a, c) {
      const run = await getRun(c, a.runId)
      const mine = run.status === 'running' && id(run.sessionOwner) === c.user.id
      if (run.mode !== 'session' || !(run.status === 'awaiting_session' || mine)) throw new Error(`run ${run.id} is not releasable`)
      if (mine) {
        const { ts, n } = await sourceOf(c, await getTicket(c, id(run.ticket)))
        await ts.release(n)
      }
      const auto = a.takeover === 'autonomous'
      await c.payload.update({
        collection: 'runs',
        id: run.id,
        data: { sessionOwner: null, heartbeatAt: null, ...(auto ? { mode: 'autonomous', status: 'queued' } : { status: 'awaiting_session' }) },
        ...scoped(c),
      })
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
      const ticket = await getTicket(c, a.ticket)
      const { ts, n } = await sourceOf(c, ticket)
      await ts.addLabels(n, [APPROVED_PLAN])
      await c.payload.create({
        collection: 'human_touches',
        data: { kind: 'approve:plan', ticket: ticket.id, workspace: id(ticket.workspace), actor: c.user.email, at: now() },
        overrideAccess: true,
      })
      return { approved: APPROVED_PLAN }
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
