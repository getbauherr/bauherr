import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { payloadClient } from './session'

const row = z.object({ id: z.coerce.number(), has_secret: z.boolean(), delivered_at: z.coerce.date().nullable() })

export type WebhookState = { hasSecret: boolean; deliveredAt: string | null }

export const webhookStates = async (workspace: number): Promise<Map<number, WebhookState>> => {
  const result = await (await payloadClient()).db.drizzle.execute(sql`
    SELECT "id", ("webhook_secret" IS NOT NULL) AS has_secret, "webhook_delivered_at" AS delivered_at
    FROM "connections" WHERE "workspace_id" = ${workspace}`)
  return new Map(
    result.rows.map((found) => {
      const parsed = row.parse(found)
      return [parsed.id, { hasSecret: parsed.has_secret, deliveredAt: parsed.delivered_at?.toISOString() ?? null }]
    }),
  )
}
