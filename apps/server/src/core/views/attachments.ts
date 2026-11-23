import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { imageTypeOf } from '../attachments/image'

const count = z.coerce.number()

const viewRow = z.object({ id: count, caption: z.string(), byte_size: count })

export type AttachmentView = { id: number; caption: string; bytes: number }

const viewOf = (row: unknown): AttachmentView => {
  const parsed = viewRow.parse(row)
  return { id: parsed.id, caption: parsed.caption, bytes: parsed.byte_size }
}

export const loadMockups = async (payload: Payload, recordId: number): Promise<AttachmentView[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT a."id", a."caption", a."byte_size" FROM "attachments" a
    WHERE a."kind" = 'mockup' AND a."content" IS NOT NULL AND a."run_id" = (
      SELECT s."id" FROM "stage_runs" s
      WHERE s."record_id" = ${recordId} AND s."stage" = 'brief' AND s."status" = 'submitted'
      ORDER BY s."id" DESC LIMIT 1)
    ORDER BY a."id"`)
  return found.rows.map(viewOf)
}

export const loadRunAttachments = async (payload: Payload, runId: number): Promise<AttachmentView[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "caption", "byte_size" FROM "attachments"
    WHERE "run_id" = ${runId} AND "content" IS NOT NULL ORDER BY "id"`)
  return found.rows.map(viewOf)
}

const imageRow = z.object({ workspace_id: count, content: z.string() })

export type StoredImage = { workspace: number; contentType: string; bytes: Buffer }

export const readImage = async (payload: Payload, id: number): Promise<StoredImage | null> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "workspace_id", "content" FROM "attachments" WHERE "id" = ${id} AND "content" IS NOT NULL`,
  )
  if (!found.rows[0]) return null
  const row = imageRow.parse(found.rows[0])
  const bytes = Buffer.from(row.content, 'base64')
  const contentType = imageTypeOf(bytes)
  return contentType === null ? null : { workspace: row.workspace_id, contentType, bytes }
}
