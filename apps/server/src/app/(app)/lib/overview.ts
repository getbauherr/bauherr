import { cache } from 'react'
import { ticketsOf } from '../../../lib/actions'
import { unansweredCriticalCount } from './plan'
import { payloadClient } from './session'
import { type Stage, needsYou, stageOf } from './needs-you'

export type RunRow = {
  id: number
  ticket: number
  stage: string
  status: string
  mode: string
  sessionOwner: number | null
  heartbeatAt: string | null
  startedAt: string | null
  finishedAt: string | null
  costUsd: number | null
  createdAt: string
}
export type TicketRow = {
  id: number
  number: number
  title: string
  url: string | null
  open: boolean
  stage: Stage
  product: { id: number; name: string } | null
  run: RunRow | null
  /** Email local-part of the session owner of a live Run; null for scheduler Runs. */
  owner: string | null
  needsYou: string | null
  /** Open Tickets this one is blocked by. */
  blockedBy: { id: number; number: number }[]
}

const LIVE = ['running', 'awaiting_session']
export const RUNS_LIMIT = 100
/** Plan comments are fetched from the forge only for tickets awaiting plan approval, at most this many per load. */
export const DECISIONS_LOOKUPS = 20
const CLOSED_LIMIT = 200
const FORGE_TIMEOUT_MS = 3000

const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => AbortSignal.timeout(ms).addEventListener('abort', () => reject(new Error('forge timeout'))))])

/** Open tickets (plus the newest closed ones when `all`), their latest Runs, and the newest Runs of the Workspace. */
export const loadOverview = cache(async (workspace: number, all: boolean): Promise<{ tickets: TicketRow[]; runs: RunRow[]; runsTotal: number; products: { id: number; name: string }[]; lookupsCapped: boolean }> => {
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const ws = { workspace: { equals: workspace } }
  const [open, closed, recent, products] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [ws, { state: { equals: 'open' } }] }, sort: '-sourceUpdatedAt', pagination: false, ...q }),
    all ? payload.find({ collection: 'tickets', where: { and: [ws, { state: { equals: 'closed' } }] }, sort: '-updatedAt', limit: CLOSED_LIMIT, ...q }) : null,
    payload.find({ collection: 'runs', where: ws, sort: '-createdAt', limit: RUNS_LIMIT, ...q }),
    payload.find({ collection: 'products', where: ws, sort: 'name', pagination: false, ...q }),
  ])
  const ticketDocs = [...open.docs, ...(closed?.docs ?? [])] as unknown as Record<string, any>[]
  const runRows = recent.docs as unknown as RunRow[]
  const known = new Set(ticketDocs.map((t) => t.id))
  const missing = [...new Set(runRows.map((r) => r.ticket))].filter((id) => !known.has(id))
  if (missing.length) {
    const extra = await payload.find({ collection: 'tickets', where: { and: [ws, { id: { in: missing } }] }, pagination: false, ...q })
    ticketDocs.push(...(extra.docs as unknown as Record<string, any>[]))
  }
  const blockerIds = [...new Set(ticketDocs.flatMap((t) => (t.blockedBy ?? []) as number[]))]
  const blockers = new Map<number, { id: number; number: number; open: boolean }>()
  if (blockerIds.length) {
    for (const b of (await payload.find({ collection: 'tickets', where: { and: [ws, { id: { in: blockerIds } }] }, pagination: false, ...q })).docs as unknown as Record<string, any>[]) blockers.set(b.id, { id: b.id, number: b.number, open: b.state !== 'closed' })
  }
  const latest = new Map<number, RunRow>()
  if (ticketDocs.length) {
    const runs = await payload.find({ collection: 'runs', where: { ticket: { in: ticketDocs.map((t) => t.id) } }, sort: '-createdAt', pagination: false, ...q })
    for (const r of runs.docs as unknown as RunRow[]) if (!latest.has(r.ticket)) latest.set(r.ticket, r)
  }
  const ownerIds = [...new Set([...latest.values()].filter((r) => LIVE.includes(r.status) && r.mode === 'session' && r.sessionOwner).map((r) => r.sessionOwner!))]
  const owners = new Map<number, string>()
  if (ownerIds.length) for (const o of (await payload.find({ collection: 'bauherren', where: { id: { in: ownerIds } }, pagination: false, ...q })).docs as unknown as { id: number; email: string }[]) owners.set(o.id, o.email.split('@')[0])
  const productRows = products.docs as unknown as { id: number; name: string }[]
  const byId = new Map(productRows.map((p) => [p.id, p]))
  const rows = ticketDocs.map((t): TicketRow => {
    const isOpen = t.state !== 'closed'
    const run = latest.get(t.id) ?? null
    return {
      id: t.id,
      number: t.number,
      title: t.title,
      url: t.url ?? null,
      open: isOpen,
      stage: stageOf(t),
      product: byId.get(t.product) ?? null,
      run,
      owner: run?.sessionOwner ? (owners.get(run.sessionOwner) ?? null) : null,
      needsYou: isOpen ? needsYou({ stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState }, run) : null,
      blockedBy: isOpen ? ((t.blockedBy ?? []) as number[]).flatMap((b) => (blockers.get(b)?.open ? [blockers.get(b)!] : [])) : [],
    }
  })
  const waiting = rows.filter((r) => r.needsYou === 'Approve plan')
  const sources = new Map<number, ReturnType<typeof ticketsOf>>()
  await Promise.all(
    waiting.slice(0, DECISIONS_LOOKUPS).map(async (row) => {
      try {
        const doc = ticketDocs.find((t) => t.id === row.id)!
        if (!sources.has(doc.product)) sources.set(doc.product, ticketsOf(payload, doc.product))
        const ts = await sources.get(doc.product)!
        if (unansweredCriticalCount(await within(ts.listComments(String(doc.number)), FORGE_TIMEOUT_MS))) row.needsYou = 'Answer decisions'
      } catch {
        // forge unreachable or slow: keep "Approve plan"
      }
    }),
  )
  return { tickets: rows, runs: runRows, runsTotal: recent.totalDocs, products: productRows, lookupsCapped: waiting.length > DECISIONS_LOOKUPS }
})
