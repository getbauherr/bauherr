import { cache } from 'react'
import { payloadClient } from './session'
import { STAGES, type Stage, needsYou } from './needs-you'

export { STAGES, VIEWS, needsYou, type Stage, type View } from './needs-you'

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

export const loadOverview = cache(async (workspace: number): Promise<{ tickets: TicketRow[]; runs: RunRow[]; products: { id: number; name: string }[] }> => {
  const payload = await payloadClient()
  const q = { where: { workspace: { equals: workspace } }, pagination: false, depth: 0, overrideAccess: true } as const
  const [tickets, runs, products] = await Promise.all([
    payload.find({ collection: 'tickets', sort: '-sourceUpdatedAt', ...q }),
    payload.find({ collection: 'runs', sort: '-createdAt', ...q }),
    payload.find({ collection: 'products', sort: 'name', ...q }),
  ])
  const runRows = runs.docs as unknown as RunRow[]
  const latest = new Map<number, RunRow>()
  for (const r of runRows) if (!latest.has(r.ticket)) latest.set(r.ticket, r)
  const productRows = products.docs as unknown as { id: number; name: string }[]
  const byId = new Map(productRows.map((p) => [p.id, p]))
  const rows = (tickets.docs as unknown as (Record<string, any>)[]).map((t): TicketRow => {
    const open = t.state !== 'closed'
    const run = latest.get(t.id) ?? null
    return {
      id: t.id,
      number: t.number,
      title: t.title,
      url: t.url ?? null,
      open,
      stage: !open ? 'done' : STAGES.includes(t.stage) ? t.stage : 'triage',
      product: byId.get(t.product) ?? null,
      run,
      needsYou: open ? needsYou({ stage: t.stage, labels: t.labels ?? [] }, run) : null,
    }
  })
  return { tickets: rows, runs: runRows, products: productRows }
})
