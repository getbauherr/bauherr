import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { decrypt } from '../../lib/secrets'
import type { Conn } from '../conn'
import type { ProductFilter } from '../views/product-settings'
import { TERMINAL_LIST } from '../views/sql'
import type { Payload } from 'payload'

export type AlertTarget = { workspace: number; enabled: boolean; secret: string | null }
export type AlertState = { enabled: boolean; hasSecret: boolean }
export type OpenAlert = { recordId: number; number: number }

const targetRow = z.object({
  workspace_id: z.coerce.number(),
  incident_intake: z.boolean().nullable(),
  incident_secret: z.string().nullable(),
})
const openRow = z.object({ id: z.coerce.number(), source_number: z.coerce.number() })

export const alertTarget = async (payload: Payload, product: number): Promise<AlertTarget | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT p."workspace_id", p."incident_intake", p."incident_secret" FROM "products" p
    JOIN "workspaces" w ON w."id" = p."workspace_id" AND w."archived_at" IS NULL WHERE p."id" = ${product}`)
  if (!found.rows[0]) return null
  const row = targetRow.parse(found.rows[0])
  return {
    workspace: row.workspace_id,
    enabled: row.incident_intake === true,
    secret: row.incident_secret ? decrypt(row.incident_secret) : null,
  }
}

export const alertState = async (payload: Payload, f: ProductFilter): Promise<AlertState> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "incident_intake", "incident_secret" FROM "products"
    WHERE "id" = ${f.product} AND "workspace_id" = ${f.workspace}`)
  const row = z
    .object({ incident_intake: z.boolean().nullable(), incident_secret: z.string().nullable() })
    .parse(found.rows[0] ?? { incident_intake: false, incident_secret: null })
  return { enabled: row.incident_intake === true, hasSecret: row.incident_secret !== null }
}

export const openAlertTicket = async (db: Conn, product: number, hash: string): Promise<OpenAlert | null> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT r."id", r."source_number" FROM "records" r
    WHERE r."product_id" = ${product} AND r."data"->'source'->>'alert' = ${hash}
      AND coalesce((SELECT e."type" FROM "events" e WHERE e."record_id" = r."id"
        AND e."type" IN (${TERMINAL_LIST}, 'ticket.restored') ORDER BY e."id" DESC LIMIT 1), 'ticket.restored')
        = 'ticket.restored'
    ORDER BY r."id" DESC LIMIT 1`)
  if (!found.rows[0]) return null
  const row = openRow.parse(found.rows[0])
  return { recordId: row.id, number: row.source_number }
}

export const alertTicketCount = async (db: Conn, product: number, hash: string): Promise<number> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT count(*) AS n FROM "records" WHERE "product_id" = ${product} AND "data"->'source'->>'alert' = ${hash}`)
  return z.coerce.number().parse(found.rows[0]?.n ?? 0)
}

export const recentAlertTickets = async (db: Conn, product: number, except: string, now: Date): Promise<number> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT count(*) AS n FROM "records" WHERE "product_id" = ${product} AND "data"->'source'->>'alert' <> ${except}
      AND "created_at" > ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz`)
  return z.coerce.number().parse(found.rows[0]?.n ?? 0)
}
