import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export const LAST_CHECK_KEY = 'readiness-check:'

export const lastCheckSchema = z.object({ at: z.string(), error: z.string().nullable() })
export type LastCheck = z.infer<typeof lastCheckSchema>

export const saveLastCheck = async (payload: Payload, source: number, check: LastCheck): Promise<void> => {
  const key = `${LAST_CHECK_KEY}${source}`
  await payload.db.drizzle.execute(sql`
    INSERT INTO "instance_state" ("key", "value") VALUES (${key}, ${JSON.stringify(check)}::jsonb)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`)
}

export const loadLastCheck = async (payload: Payload, source: number): Promise<LastCheck | null> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "value" FROM "instance_state" WHERE "key" = ${`${LAST_CHECK_KEY}${source}`}`,
  )
  const parsed = lastCheckSchema.safeParse(found.rows[0]?.value)
  return parsed.success ? parsed.data : null
}
