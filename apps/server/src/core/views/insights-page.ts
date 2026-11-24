import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { outsideCost } from '../cost-store'
import { summarizeCost, type CostSummary } from './cost-view'
import { summarize, type TimeSummary } from './insights'
import { ago } from './sql'
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
}

export type InsightsFilter = { workspace: number; product?: number | undefined; days: Range; now: Date }

const productRow = z.object({ id: z.coerce.number(), name: z.string() })

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
  }
}
