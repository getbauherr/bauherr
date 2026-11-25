import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { attachmentTypeOf, HTML_TYPE } from '../attachments/image'
import { screenOf } from '../attachments/pairs'
import type { Conn } from '../conn'

const count = z.coerce.number()

const viewRow = z.object({ id: count, caption: z.string(), byte_size: count, content_type: z.string() })

export type AttachmentView = { id: number; caption: string; screen: string; bytes: number; html: boolean }

const viewOf = (row: unknown): AttachmentView => {
  const parsed = viewRow.parse(row)
  return {
    id: parsed.id,
    caption: parsed.caption,
    screen: screenOf(parsed.caption),
    bytes: parsed.byte_size,
    html: parsed.content_type === HTML_TYPE,
  }
}

export const loadMockups = async (payload: Conn, recordId: number): Promise<AttachmentView[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT a."id", a."caption", a."byte_size", a."content_type" FROM "attachments" a
    WHERE a."kind" = 'mockup' AND a."content" IS NOT NULL AND a."run_id" = (
      SELECT s."id" FROM "stage_runs" s
      WHERE s."record_id" = ${recordId} AND s."stage" = 'brief' AND s."status" = 'submitted'
      ORDER BY s."id" DESC LIMIT 1)
    ORDER BY a."id"`)
  return found.rows.map(viewOf)
}

export const loadRunMockups = async (payload: Payload, runId: number): Promise<AttachmentView[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "caption", "byte_size", "content_type" FROM "attachments"
    WHERE "run_id" = ${runId} AND "kind" = 'mockup' AND "content" IS NOT NULL ORDER BY "id"`)
  return found.rows.map(viewOf)
}

export const loadRunAttachments = async (payload: Payload, runId: number): Promise<AttachmentView[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "caption", "byte_size", "content_type" FROM "attachments"
    WHERE "run_id" = ${runId} AND "content" IS NOT NULL ORDER BY "id"`)
  return found.rows.map(viewOf)
}

const imageRow = z.object({
  workspace_id: count,
  product_id: count.nullable(),
  record_id: count.nullable(),
  content: z.string(),
})

export type StoredImage = {
  workspace: number
  product: number | null
  record: number | null
  contentType: string
  bytes: Buffer
}

export const readImage = async (payload: Payload, id: number): Promise<StoredImage | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT a."workspace_id", a."record_id", r."product_id", a."content" FROM "attachments" a
    LEFT JOIN "records" r ON r."id" = a."record_id"
    WHERE a."id" = ${id} AND a."content" IS NOT NULL`)
  if (!found.rows[0]) return null
  const row = imageRow.parse(found.rows[0])
  const bytes = Buffer.from(row.content, 'base64')
  const contentType = attachmentTypeOf(bytes)
  return contentType === null
    ? null
    : { workspace: row.workspace_id, product: row.product_id, record: row.record_id, contentType, bytes }
}
