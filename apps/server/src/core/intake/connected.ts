import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

export const markConnected = async (payload: Payload, product: number, now: Date): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "products" SET "connected_at" = ${now.toISOString()}::timestamptz, "updated_at" = now()
    WHERE "id" = ${product} AND "connected_at" IS NULL`)
}
