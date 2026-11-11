import { workflowFor } from '../factory'
import { untrustedBlock } from '@bauherr/runner'
import { loadOverviewRows } from '../../app/(app)/lib/overview'
import { plainStatus } from '../../app/(app)/lib/epics'
import { loadRun } from '../../app/(app)/lib/run'
import { loadTeam, type TeamSession } from '../sessions'
import { digest, callTool, tools as mcpTools, type Ctx } from '../mcp-tools'
import { type Kind, board, byKind, nameOf, title as stageTitle } from '../workflow'

type Doc = Record<string, any>
export type ToolKind = 'read' | 'confirm'
export type ChatTool = { name: string; description: string; input_schema: Record<string, unknown>; kind: ToolKind }
export type Card = { title: string; details: { label: string; value: string }[]; destructive?: boolean }
/** `reply` answers the model without running anything (unknown or ambiguous Ticket number). */
export type Resolved = { input: Doc } | { reply: string; ok: boolean }

const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))
const o = { depth: 0, overrideAccess: true } as const
const prop = (description: string, extra: object = {}) => ({ type: 'string', description, ...extra })
const ticketArgs = {
  ticket: { type: 'integer', description: 'Ticket number, e.g. 123 for #123' },
  product: prop('Product slug; only needed when the number exists in more than one Product'),
}
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })
const withTicket = (extra: Record<string, unknown> = {}, required: string[] = []) => schema({ ...ticketArgs, ...extra }, ['ticket', ...required])

type Entry = {
  description?: string
  schema: Record<string, unknown>
  kind: ToolKind
  /** Local handler; without it the MCP tool of the same name runs. */
  local?: (c: Ctx, input: Doc) => Promise<unknown>
  /** Ticket number (and optional Product slug) in the model's input to the id the MCP tool takes. */
  ticket?: (ticketId: number | string, input: Doc, c: Ctx) => Doc
  fence?: boolean
  describe?: (c: Ctx, input: Doc) => Promise<Card>
}

/** Open and closed Tickets of the Workspace by number; several Products can share one. */
const findByNumber = async (c: Ctx, number: unknown, product?: unknown): Promise<Resolved & { ticket?: Doc }> => {
  if (!Number.isInteger(number)) return { reply: 'ticket must be a Ticket number (integer)', ok: false }
  const { docs } = await c.payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: c.workspace } }, { number: { equals: number } }] }, limit: 20, depth: 1, overrideAccess: true })
  const hits = (docs as Doc[]).filter((t) => !product || t.product?.slug === product)
  if (!hits.length) return { reply: `No Ticket #${number}${product ? ` in Product ${product}` : ''} in this Workspace.`, ok: false }
  if (hits.length > 1) return { reply: JSON.stringify({ ambiguous: `Ticket #${number} exists in several Products; ask which one and call again with product.`, candidates: hits.map((t) => ({ number: t.number, title: t.title, product: t.product?.slug })) }), ok: true }
  return { input: {}, ticket: hits[0] }
}

const ticketOf = async (c: Ctx, ticketId: unknown): Promise<Doc | null> => {
  const t = (await c.payload.findByID({ collection: 'tickets', id: ticketId as number, ...o }).catch(() => null)) as Doc | null
  return t && String(id(t.workspace)) === String(c.workspace) ? t : null
}

const ticketLine = (t: Doc) => `#${t.number} ${t.title}`
const stageOf = (t: Doc): string => {
  const wf = workflowFor(t.workspace)
  return t.state === 'closed' ? nameOf(wf, 'done') : (t.stage ?? nameOf(wf, 'triage'))
}
const stageOfTicket = (t: Doc) => stageTitle(workflowFor(t.workspace), stageOf(t))
const gateCard = (heading: (t: Doc) => string, next: string, o: { kind?: Kind; destructive?: boolean; extra?: (i: Doc) => { label: string; value: string }[] } = {}) =>
  async (c: Ctx, input: Doc): Promise<Card> => {
    const { kind, destructive = false, extra = () => [] } = o
    const t = await ticketOf(c, input.ticket)
    if (!t) throw new Error('Ticket not found in this Workspace')
    const wf = workflowFor(t.workspace)
    const stage = kind && byKind(wf, kind)?.name
    if (stage && stageOf(t) !== stage) throw new Error(`${ticketLine(t)} is in ${stageTitle(wf, stageOf(t))}, not ${stageTitle(wf, stage)}`)
    return { title: heading(t), details: [{ label: 'Ticket', value: ticketLine(t) }, { label: 'Stage', value: stageOfTicket(t) }, ...extra(input), { label: 'What happens next', value: next }], ...(destructive && { destructive }) }
  }
const note = (i: Doc) => (typeof i.note === 'string' && i.note.trim() ? [{ label: 'Note', value: i.note.trim() }] : [])

type Overview = Awaited<ReturnType<typeof loadOverviewRows>>
const needLine = (t: Overview['tickets'][number]) => ({ number: t.number, title: t.title, need: t.needsYou })

/** Stages in workflow order with ticket counts and WIP limits, plus the open Tickets that need the person. */
export const factoryStatus = async (workspace: number | string) => {
  const { tickets, wip } = await loadOverviewRows(Number(workspace), false)
  const wf = workflowFor(workspace)
  return {
    stages: board(wf).map((s) => ({ stage: wf.stages.find((d) => d.name === s)!.title, tickets: tickets.filter((t) => t.open && t.stage === s).length, wipLimit: wip[s]?.limit ?? null })),
    needYou: tickets.filter((t) => t.open && t.needsYou).map(needLine),
  }
}

const listTickets = async (c: Ctx, a: Doc) => {
  const wf = workflowFor(c.workspace)
  const state = a.state === 'closed' || a.state === 'all' ? a.state : 'open'
  const limit = Math.min(Math.max(Number(a.limit) || 20, 1), 50)
  const q = typeof a.search === 'string' ? a.search.trim().toLowerCase() : ''
  const { tickets } = await loadOverviewRows(Number(c.workspace), state !== 'open')
  const rows = tickets
    .filter((t) => (state === 'all' || (state === 'open') === t.open) && (!a.stage || t.stage === a.stage) && (!a.needsYouOnly || t.needsYou) && (!q || t.title.toLowerCase().includes(q)))
    .sort((x, y) => y.number - x.number)
  return {
    total: rows.length,
    tickets: rows.slice(0, limit).map((t) => ({ number: t.number, title: t.title, product: t.product?.name ?? null, stage: stageTitle(wf, t.stage), status: plainStatus(wf, t), need: t.needsYou, waiting: t.waiting, blockedBy: t.blockedBy.map((b) => b.number) })),
  }
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null)
const getRun = async (c: Ctx, a: Doc) => {
  const admin = c.user.role === 'admin'
  const loaded = await loadRun(Number(c.workspace), String(a.run), false).catch(() => null)
  if (!loaded) return { error: `No Run ${a.run} in this Workspace.` }
  const { run, ticket } = loaded
  const wf = workflowFor(c.workspace)
  return {
    run: run.id,
    ticket: { number: ticket.number, title: ticket.title },
    stage: stageTitle(wf, run.stage),
    status: run.status,
    started: run.startedAt,
    finished: run.finishedAt,
    ...(admin && { mode: run.mode, costUsd: run.costUsd, model: run.model }),
    error: clip(run.error, 1000),
    evidence: run.evidence ? untrustedBlock(clip(run.evidence, 1500)!) : null,
  }
}

/** Who works right now: per role its agent sessions (status, Ticket, client, model, active minutes) and the autonomous Runs, from the database only. */
export const teamStatus = async (c: Ctx) => {
  const { roles, orphans } = await loadTeam(c.payload, c.workspace!)
  const mins = (s: number) => Math.round(s / 60)
  const session = (x: TeamSession) => ({ session: x.label ?? x.publicId, status: x.status, ticket: x.ticket ? `#${x.ticket.number} ${x.ticket.title}` : null, client: [x.clientName, x.clientVersion].filter(Boolean).join(' ') || null, model: x.model, activeMinutesToday: mins(x.activeSecondsToday), activeMinutesTotal: mins(x.activeSecondsTotal) })
  return {
    roles: roles.map((r) => ({ role: r.title, ...(r.agents && { agentsCap: r.agents }), sessions: r.sessions.map(session), autonomous: r.autonomous.map((a) => ({ executor: a.executor ?? 'runner', ticket: `#${a.ticket.number} ${a.ticket.title}`, model: a.model })) })),
    ...(orphans.length && { sessionsOfRemovedRoles: orphans.map((x) => ({ role: x.role, ...session(x) })) }),
  }
}

/** list_frontier spans every Workspace of the caller; keep this one's Tickets. */
const frontierIn = async (c: Ctx, a: Doc) => {
  const rows = (await callTool(c, 'list_frontier', { product: a.product })) as Doc[]
  if (!rows.length) return rows
  const mine = new Set((await c.payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: c.workspace } }, { id: { in: rows.map((r) => r.ticket) } }] }, pagination: false, select: {}, ...o })).docs.map((d) => d.id))
  return rows.filter((r) => mine.has(r.ticket)).map(({ ticket: _id, labels: _l, ...r }) => r)
}

const ENTRIES: Record<string, Entry> = {
  factory_status: { description: 'The factory at a glance: every stage in workflow order with its ticket count and WIP limit, and the open Tickets that need the person (number, title, what is needed).', schema: schema({}), kind: 'read', local: (c) => factoryStatus(c.workspace!) },
  list_tickets: {
    description: 'List Tickets of this Workspace (newest first, at most 50): number, title, product, stage, status, what is needed, waiting reason, blockers.',
    schema: schema({ stage: prop('Stage name, e.g. plan, build, review, release'), needsYouOnly: { type: 'boolean' }, state: prop('open (default), closed or all', { enum: ['open', 'closed', 'all'] }), search: prop('Words in the title'), limit: { type: 'integer', maximum: 50 } }),
    kind: 'read',
    local: listTickets,
  },
  team_status: { description: 'Who is working right now: every role of the team with its agent sessions (working, idle or offline, on which Ticket, client, model, active minutes today and in total) and the autonomous Runs working for it.', schema: schema({}), kind: 'read', local: teamStatus },
  get_run: { description: 'What the Run page shows: stage, status, started/finished, error or reason, evidence excerpt (Admins also see mode, model and cost).', schema: schema({ run: { type: 'integer', description: 'Run id, as in /runs/<id>' } }, ['run']), kind: 'read', local: getRun },
  list_frontier: { description: 'Open, unblocked Tickets with stage and latest Run state, in pull order.', schema: schema({ product: prop('Product slug') }), kind: 'read', local: frontierIn },
  get_ticket: { schema: withTicket(), kind: 'read', ticket: (t) => ({ ticket: t }), fence: true },
  read_worklog: { description: 'The worklog Comment of a Ticket (what was done and decided so far).', schema: withTicket(), kind: 'read', ticket: (t) => ({ ticket: t }), fence: true },
  read_knowledge: { schema: schema({ path: prop('Path relative to pack/ or the Knowledge repo'), product: prop('Product slug whose layer applies') }, ['path']), kind: 'read' },
  search_knowledge: { schema: schema({ query: prop('Words to find (quotes for phrases, - to exclude)'), product: prop('Product slug whose layer applies') }, ['query']), kind: 'read' },
  approve: {
    description: 'Approve the plan of a Ticket (the plan gate). Only after the person asked for it; they confirm on a card first.',
    schema: withTicket(),
    kind: 'confirm',
    ticket: (t, _i, c) => ({ ticket: t, gate: 'plan', workspaceId: c.workspace }),
    describe: gateCard((t) => `Approve the plan for ${ticketLine(t)}`, 'Build starts when a slot is free', { kind: 'plan' }),
  },
  accept_staging: {
    description: 'Accept a Ticket on staging (release gate); it moves to done.',
    schema: withTicket(),
    kind: 'confirm',
    ticket: (t, _i, c) => ({ ticket: t, workspaceId: c.workspace }),
    describe: gateCard((t) => `Accept ${ticketLine(t)} on staging`, 'The Ticket moves to Done; a production approval may follow', { kind: 'release' }),
  },
  approve_production: {
    description: 'Approve the production deploy of a Ticket accepted on staging, or retry a failed deploy.',
    schema: withTicket(),
    kind: 'confirm',
    ticket: (t, _i, c) => ({ ticket: t, workspaceId: c.workspace }),
    describe: gateCard((t) => `Deploy ${ticketLine(t)} to production`, "The Product's own pipeline deploys; Bauherr observes the result", { kind: 'release', destructive: true }),
  },
  decide: {
    description: 'Decide a Ticket waiting in a human stage of the workflow: outcome is one of that stage\'s outcome keys.',
    schema: withTicket({ outcome: prop('One of the stage\'s outcome keys'), note: prop('Optional note') }, ['outcome']),
    kind: 'confirm',
    ticket: (t, i, c) => ({ ticket: t, outcome: i.outcome, note: i.note, workspaceId: c.workspace }),
    describe: async (c, input) => gateCard((t) => `Decide ${ticketLine(t)}: ${String(input.outcome)}`, 'The Ticket moves where the stage maps this outcome', { extra: (i) => [{ label: 'Outcome', value: String(i.outcome) }, ...note(i)] })(c, input),
  },
  grant_review_round: {
    description: 'At the review round cap, grant exactly one more review round.',
    schema: withTicket(),
    kind: 'confirm',
    ticket: (t, _i, c) => ({ ticket: t, workspaceId: c.workspace }),
    describe: gateCard((t) => `Grant one more review round for ${ticketLine(t)}`, 'The Ticket goes back to Build on the same MR', { kind: 'review' }),
  },
  stop_review: {
    description: 'At the review round cap, stop: the MR stays open and the Ticket moves to triage.',
    schema: withTicket({ note: prop('Why it was stopped') }),
    kind: 'confirm',
    ticket: (t, i, c) => ({ ticket: t, note: i.note, workspaceId: c.workspace }),
    describe: gateCard((t) => `Stop the review of ${ticketLine(t)}`, 'The MR stays open and the Ticket moves to Triage', { kind: 'review', destructive: true, extra: note }),
  },
  request_changes: {
    description: 'Send a Ticket in release back to Build with a note; starts a Build Run.',
    schema: withTicket({ note: prop('What must change') }, ['note']),
    kind: 'confirm',
    ticket: (t, i, c) => ({ ticket: t, note: i.note, workspaceId: c.workspace }),
    describe: gateCard((t) => `Request changes on ${ticketLine(t)}`, 'The Ticket goes back to Build with your note; a Build Run starts', { extra: note }),
  },
  approve_skill_proposal: {
    description: 'Approve a distilled skill proposal (Admin only): merges its Knowledge PR if the PR head is still expectSha.',
    schema: schema({ proposal: { type: 'integer', description: 'Skill proposal id' }, expectSha: prop('Head sha of the PR as reviewed') }, ['proposal', 'expectSha']),
    kind: 'confirm',
    describe: async (c, i) => {
      const p = (await c.payload.findByID({ collection: 'skill_proposals', id: i.proposal, ...o }).catch(() => null)) as Doc | null
      if (!p || String(id(p.workspace)) !== String(c.workspace)) throw new Error('Skill proposal not found in this Workspace')
      const t = await ticketOf(c, id(p.ticket))
      return {
        title: `Approve skill proposal ${p.id}${t ? ` from ${ticketLine(t)}` : ''}`,
        details: [{ label: 'Skill', value: String(p.skillPath ?? '') }, { label: 'Pull request', value: `#${p.pr}` }, { label: 'Status', value: String(p.status) }, { label: 'What happens next', value: `The Knowledge PR is merged if its head is still ${String(i.expectSha).slice(0, 12)}` }],
        destructive: true,
      }
    },
  },
  reject_skill_proposal: {
    description: 'Reject a distilled skill proposal (Admin only): closes its Knowledge PR.',
    schema: schema({ proposal: { type: 'integer', description: 'Skill proposal id' }, note: prop('Why it is rejected (optional)') }, ['proposal']),
    kind: 'confirm',
    describe: async (c, i) => {
      const p = (await c.payload.findByID({ collection: 'skill_proposals', id: i.proposal, ...o }).catch(() => null)) as Doc | null
      if (!p || String(id(p.workspace)) !== String(c.workspace)) throw new Error('Skill proposal not found in this Workspace')
      const t = await ticketOf(c, id(p.ticket))
      return {
        title: `Reject skill proposal ${p.id}${t ? ` from ${ticketLine(t)}` : ''}`,
        details: [{ label: 'Skill', value: String(p.skillPath ?? '') }, { label: 'Pull request', value: `#${p.pr}` }, { label: 'What happens next', value: 'The Knowledge PR is closed and nothing is merged' }],
        destructive: true,
      }
    },
  },
}

const mcp = (name: string) => mcpTools.find((t) => t.name === name)!

/** The chat tool set; the client picks widgets by `kind`, never by name. */
export const chatTools = (): ChatTool[] =>
  Object.entries(ENTRIES).map(([name, e]) => ({ name, description: e.description ?? mcp(name).description, input_schema: e.schema, kind: e.kind }))

export const kindOf = (name: string): ToolKind | undefined => ENTRIES[name]?.kind

/** The canonical input the tool runs with: Ticket numbers become ids inside the Workspace. This exact value is what a confirmation stores and later runs. */
export const resolveInput = async (c: Ctx, name: string, input: unknown): Promise<Resolved> => {
  const e = ENTRIES[name]
  if (!e) return { reply: `unknown tool ${name}`, ok: false }
  const a = (input && typeof input === 'object' ? input : {}) as Doc
  if (!e.ticket) return { input: a }
  const f = await findByNumber(c, a.ticket, a.product)
  return f.ticket ? { input: e.ticket(f.ticket.id, a, c) } : (f as { reply: string; ok: boolean })
}

export const describe = async (name: string, input: Doc, c: Ctx): Promise<Card> => ENTRIES[name]!.describe!(c, input)

/** One line for the tool-call event and the audit trail. */
export const summarize = (name: string, input: unknown): string =>
  `${name}(${Object.entries((input ?? {}) as Doc).filter(([k]) => k !== 'workspaceId').map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)}`).join(', ')})`

const audit = async (c: Ctx, name: string, input: unknown, ok: boolean, t0: number): Promise<void> => {
  await c.payload.create({ collection: 'tool_calls', data: { workspace: c.workspace, name, inputDigest: digest(input), status: ok ? 'ok' : 'error', durationMs: Date.now() - t0 }, overrideAccess: true })
}

/** Runs one chat tool as the signed-in person (human actor) on a canonical input from `resolveInput`; both local and MCP tools write a tool_calls row. Forge text in the result is fenced as untrusted. */
export const runChatTool = async (c: Ctx, name: string, input: Doc): Promise<unknown> => {
  const e = ENTRIES[name]
  if (!e) throw new Error(`unknown tool ${name}`)
  if (!e.local) {
    const out = await callTool(c, name, input)
    return e.fence ? fenceTicket(out) : out
  }
  const t0 = Date.now()
  let ok = false
  try {
    const out = await e.local(c, input)
    ok = true
    return out
  } finally {
    await audit(c, name, input, ok, t0)
  }
}

const fenceTicket = (out: unknown): unknown => {
  if (typeof out === 'string') return untrustedBlock(out)
  const { number, title, stage, state, labels, url, pr, body, goal } = out as Doc
  return { number, title, stage, state, labels, url, pr, content: untrustedBlock(JSON.stringify({ body, goal })) }
}
