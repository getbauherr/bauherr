import { cache } from 'react'
import { payloadClient } from './session'
import { type Stage, needsYou, stageOf } from './needs-you'

export type RunRow = {
  id: number
  ticket: number
  stage: string
  status: string
  mode: string
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
  needsYou: string | null
}

export const RUNS_LIMIT = 100
const CLOSED_LIMIT = 200

/** Open tickets (plus the newest closed ones when `all`), their latest Runs, and the newest Runs of the Workspace. */
export const loadOverview = cache(async (workspace: number, all: boolean): Promise<{ tickets: TicketRow[]; runs: RunRow[]; runsTotal: number; products: { id: number; name: string }[] }> => {
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
  const latest = new Map<number, RunRow>()
  if (ticketDocs.length) {
    const runs = await payload.find({ collection: 'runs', where: { ticket: { in: ticketDocs.map((t) => t.id) } }, sort: '-createdAt', pagination: false, ...q })
    for (const r of runs.docs as unknown as RunRow[]) if (!latest.has(r.ticket)) latest.set(r.ticket, r)
  }
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
      needsYou: isOpen ? needsYou({ stage: t.stage, labels: t.labels ?? [] }, run) : null,
    }
  })
  return { tickets: rows, runs: runRows, runsTotal: recent.totalDocs, products: productRows }
})
