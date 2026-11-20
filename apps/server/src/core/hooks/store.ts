import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { decrypt } from '../../lib/secrets'
import type { HookHead, HookItem } from './reduce'

const count = z.coerce.number()
const webhookRow = z.object({ kind: z.string(), webhook_secret: z.string().nullable() })
const sourceRow = z.object({ id: count })
const numberRow = z.object({ number: count })

export type Webhook = { kind: string; secret: string | null }

export const webhookOf = async (payload: Payload, connection: number): Promise<Webhook | null> => {
  const result = await payload.db.drizzle.execute(
    sql`SELECT "kind", "webhook_secret" FROM "connections" WHERE "id" = ${connection}`,
  )
  const row = result.rows[0] ? webhookRow.parse(result.rows[0]) : null
  if (!row) return null
  return { kind: row.kind, secret: row.webhook_secret ? decrypt(row.webhook_secret) : null }
}

export const markDelivered = async (payload: Payload, connection: number, now: Date): Promise<void> => {
  await payload.db.drizzle.execute(
    sql`UPDATE "connections" SET "webhook_delivered_at" = ${now.toISOString()}::timestamptz WHERE "id" = ${connection}`,
  )
}

export const trackedSource = async (payload: Payload, connection: number, repo: string): Promise<number | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT s."id" FROM "ticket_sources" s
    JOIN "workspaces" w ON w."id" = s."workspace_id" AND w."archived_at" IS NULL
    WHERE s."connection_id" = ${connection} AND lower(s."repo") = lower(${repo})
    ORDER BY s."id" LIMIT 1`)
  return result.rows[0] ? sourceRow.parse(result.rows[0]).id : null
}

export const openPullsAt = async (payload: Payload, source: number, head: HookHead): Promise<HookItem[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "number" FROM "mirror_items"
    WHERE "source_id" = ${source} AND "kind" = 'pr' AND "state" = 'open' AND "gone_at" IS NULL
      AND "head_sha" = ${head.sha}`)
  return result.rows.map((row) => ({ repo: head.repo, kind: 'pr' as const, number: numberRow.parse(row).number }))
}
