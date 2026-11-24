import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { TERMINAL_LIST } from '../views/sql'
import type { CheckId } from './checks'

export const READINESS_KEY = 'readiness-tickets:'

export type OpenTicket = { number: number; recordId: number | null }
export type Opened = { check: string; number: number; open: boolean; recordId: number | null }

const row = z.object({
  check_id: z.string(),
  number: z.coerce.number(),
  record_id: z.coerce.number().nullable(),
  last_end: z.string().nullable(),
  item_state: z.string().nullable(),
})

export const openedTickets = async (payload: Payload, product: number): Promise<Opened[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT k."key" AS check_id, k."value"::integer AS number, rec."id" AS record_id,
      (SELECT e."type" FROM "events" e WHERE e."record_id" = rec."id"
        AND e."type" IN (${TERMINAL_LIST}, 'ticket.restored') ORDER BY e."id" DESC LIMIT 1) AS last_end,
      (SELECT i."state" FROM "mirror_items" i WHERE i."product_id" = p."id" AND i."kind" = 'issue'
        AND i."number" = k."value"::integer LIMIT 1) AS item_state
    FROM "products" p
    JOIN "instance_state" st ON st."key" = ${`${READINESS_KEY}${product}`}
    CROSS JOIN LATERAL jsonb_each_text(st."value") k
    LEFT JOIN "records" rec ON rec."product_id" = p."id" AND rec."source_number" = k."value"::integer
      AND rec."data"->'source'->>'readiness' = k."key"
    WHERE p."id" = ${product}`)
  return found.rows.map((raw) => {
    const parsed = row.parse(raw)
    const open =
      parsed.record_id === null
        ? parsed.item_state === null || parsed.item_state === 'open'
        : parsed.last_end === null || parsed.last_end === 'ticket.restored'
    return { check: parsed.check_id, number: parsed.number, open, recordId: parsed.record_id }
  })
}

export const openTicketOf = (opened: Opened[], check: CheckId): OpenTicket | null => {
  const found = opened.find((entry) => entry.check === check && entry.open)
  return found ? { number: found.number, recordId: found.recordId } : null
}

export const readinessReference = (product: number, check: CheckId, previous: number | null): string =>
  `bauherr-readiness-${product}-${check}${previous === null ? '' : `-after-${previous}`}`

export const productOfRecord = async (payload: Payload, recordId: number): Promise<number | null> => {
  const found = await payload.db.drizzle.execute(sql`SELECT "product_id" FROM "records" WHERE "id" = ${recordId}`)
  const raw = found.rows[0]
  return raw ? z.coerce.number().parse(raw.product_id) : null
}
