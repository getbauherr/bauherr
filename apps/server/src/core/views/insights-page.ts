import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { outsideCost } from '../cost-store'
import { summarizeCost, type CostSummary } from './cost-view'
import { summarize, type TimeSummary } from './insights'
import { ago, scope } from './sql'
import { doneTickets } from './time-load'

export const RANGES = [7, 30, 90] as const
export type Range = (typeof RANGES)[number]

export type InsightsView = {
  days: Range
  product: number | null
  products: { id: number; name: string }[]
  time: TimeSummary
  cost: CostSummary
  outside: number | null
  autoAccepted: { total: number; sentBack: number }
}

export type InsightsFilter = { workspace: number; product?: number | undefined; days: Range; now: Date }

const productRow = z.object({ id: z.coerce.number(), name: z.string() })
const autoRow = z.object({ total: z.coerce.number(), sent_back: z.coerce.number() })

const autoAcceptedOf = async (payload: Payload, f: InsightsFilter, product: number | undefined) => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT count(*) AS total, count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM "events" s WHERE s."record_id" = e."record_id" AND s."type" = 'result.sent-back' AND s."id" > e."id"
    )) AS sent_back
    FROM "events" e JOIN "records" r ON r."id" = e."record_id"
    WHERE ${scope(f.workspace, product)} AND e."type" = 'result.accepted' AND e."actor" = 'factory'
      AND e."actor_id" = 'auto-accept' AND e."created_at" >= ${ago(f.now, f.days)}::timestamptz`)
  const row = autoRow.parse(found.rows[0])
  return { total: row.total, sentBack: row.sent_back }
}

const productsOf = async (payload: Payload, workspace: number) => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "id", "name" FROM "products" WHERE "workspace_id" = ${workspace} ORDER BY "name", "id"`,
  )
  return found.rows.map((row) => productRow.parse(row))
}

export const insightsPage = async (payload: Payload, filter: InsightsFilter): Promise<InsightsView> => {
  const { workspace, days, now } = filter
  const products = await productsOf(payload, workspace)
  const product = products.find((entry) => entry.id === filter.product)?.id
  const tickets = await doneTickets(payload, { workspace, now, days, ...(product === undefined ? {} : { product }) })
  const stored = await outsideCost(payload, workspace)
  const from = ago(now, days).slice(0, 10)
  const outside = stored
    ? Object.entries(stored.days).reduce((sum, [day, cost]) => (day >= from ? sum + cost : sum), 0)
    : null
  return {
    days,
    product: product ?? null,
    products,
    time: summarize(tickets.map((ticket) => ticket.time)),
    cost: summarizeCost(tickets),
    outside,
    autoAccepted: await autoAcceptedOf(payload, filter, product),
  }
}
