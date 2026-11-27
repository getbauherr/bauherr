import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { createConversation } from '../conversations/store'
import type { Conn } from '../conn'

const steeringTitle = (recordId: number): string => `Ticket ${recordId} steering`

const idRow = z.object({ id: z.coerce.number() })

export const findSteerConversation = async (db: Conn, workspace: number, recordId: number): Promise<number | null> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT "id" FROM "conversations"
    WHERE "record_id" = ${recordId} AND "workspace_id" = ${workspace} AND "title" = ${steeringTitle(recordId)}
    ORDER BY "id" LIMIT 1`)
  return found.rows[0] ? idRow.parse(found.rows[0]).id : null
}

export const steerConversation = async (payload: Payload, workspace: number, recordId: number): Promise<number> =>
  (await findSteerConversation(payload, workspace, recordId)) ??
  createConversation(payload, workspace, steeringTitle(recordId), recordId)
