import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { TargetNotFound } from './errors'

export type Target = { recordId: number; itemId: number }
export type ProductTarget = { workspace: number; product: number }

export type ProductRow = {
  source: number
  repo: string
  connection: number
  productName: string
  productState: string
}

export type WriteRow = {
  workspace: number
  product: number
  source: number
  repo: string
  number: number
  kind: 'issue' | 'pr'
  labels: string[]
  connection: number
  productName: string
  productState: string
  statusCommentId: string | null
  statusCommentHash: string | null
}

const count = z.coerce.number()

const productRowSchema = z.object({
  source_id: count,
  repo: z.string(),
  connection_id: count,
  product_name: z.string(),
  product_state: z.string(),
})

export const loadProductRow = async (payload: Payload, target: ProductTarget): Promise<ProductRow> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT s."id" AS source_id, s."repo", s."connection_id", p."name" AS product_name, p."state" AS product_state
    FROM "products" p JOIN "ticket_sources" s ON s."product_id" = p."id"
    WHERE p."id" = ${target.product} AND p."workspace_id" = ${target.workspace}
    ORDER BY s."id" LIMIT 1`)
  const row = result.rows[0]
  if (!row) {
    throw new TargetNotFound(`Product ${target.product} has no repository in this Workspace: connect one first.`)
  }
  const parsed = productRowSchema.parse(row)
  return {
    source: parsed.source_id,
    repo: parsed.repo,
    connection: parsed.connection_id,
    productName: parsed.product_name,
    productState: parsed.product_state,
  }
}

const rowSchema = z.object({
  workspace_id: count,
  product_id: count,
  source_id: count,
  repo: z.string(),
  number: count,
  kind: z.enum(['issue', 'pr']),
  labels: z.array(z.string()).nullable(),
  connection_id: count,
  product_name: z.string(),
  product_state: z.string(),
  status_comment_id: z.string().nullable(),
  status_comment_hash: z.string().nullable(),
})

export const loadWriteRow = async (payload: Payload, target: Target): Promise<WriteRow> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."workspace_id", i."product_id", i."source_id", i."repo", i."number", i."kind", i."labels",
      s."connection_id", p."name" AS product_name, p."state" AS product_state,
      r."status_comment_id", r."status_comment_hash"
    FROM "mirror_items" i
    JOIN "records" r ON r."id" = ${target.recordId} AND r."product_id" = i."product_id"
    JOIN "products" p ON p."id" = i."product_id"
    JOIN "ticket_sources" s ON s."id" = i."source_id"
    WHERE i."id" = ${target.itemId}`)
  const row = result.rows[0]
  if (!row) {
    throw new TargetNotFound(
      `Item ${target.itemId} of record ${target.recordId} does not exist: pass the record and an item of its Product.`,
    )
  }
  const parsed = rowSchema.parse(row)
  return {
    workspace: parsed.workspace_id,
    product: parsed.product_id,
    source: parsed.source_id,
    repo: parsed.repo,
    number: parsed.number,
    kind: parsed.kind,
    labels: parsed.labels ?? [],
    connection: parsed.connection_id,
    productName: parsed.product_name,
    productState: parsed.product_state,
    statusCommentId: parsed.status_comment_id,
    statusCommentHash: parsed.status_comment_hash,
  }
}

export const saveLabels = async (payload: Payload, itemId: number, labels: string[]): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "mirror_items" SET "labels" = ${JSON.stringify(labels)}::jsonb, "updated_at" = now()
    WHERE "id" = ${itemId}`)
}

export const saveClosed = async (
  payload: Payload,
  itemId: number,
  state: 'closed' | 'merged',
  at: Date,
): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "mirror_items" SET "state" = ${state}, "forge_closed_at" = ${at.toISOString()}::timestamptz,
      "updated_at" = now()
    WHERE "id" = ${itemId}`)
}

export const saveReopened = async (payload: Payload, itemId: number): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "mirror_items" SET "state" = 'open', "forge_closed_at" = NULL, "updated_at" = now()
    WHERE "id" = ${itemId}`)
}

export const saveStatusComment = async (
  payload: Payload,
  recordId: number,
  commentId: string,
  hash: string,
): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "records" SET "status_comment_id" = ${commentId}, "status_comment_hash" = ${hash}, "updated_at" = now()
    WHERE "id" = ${recordId}`)
}
