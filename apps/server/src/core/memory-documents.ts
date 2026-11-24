import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { mayDecide } from './decide'
import {
  DOCUMENT_SCOPES,
  MemoryInvalid,   MemoryNotFound,
  NotAllowedToChangeMemory,
  type MemoryStage,
  type Who,
} from './memory'
import { partsFor } from './memory-sections'

export const DOCUMENT_MAX_LINES = 200
export const DOCUMENT_REASONS = ['edited', 'retro'] as const

export type DocumentScope = (typeof DOCUMENT_SCOPES)[number]
export type DocumentReason = (typeof DOCUMENT_REASONS)[number]
export type DocumentTarget =
  | { scope: 'factory' }
  | { scope: 'workspace'; workspace: number }
  | { scope: 'product'; workspace: number; product: number }
export type DocumentVersion = { id: number; body: string; author: string; reason: DocumentReason; at: string }
export type MemoryPart = { scope: DocumentScope; text: string }

const versionRow = z.object({
  id: z.number(),
  body: z.string(),
  author: z.string(),
  reason: z.enum(DOCUMENT_REASONS),
  created_at: z.coerce.date(),
})

const owned = z.object({ workspace_id: z.number().nullable() })

const whereOf = (target: DocumentTarget) =>
  target.scope === 'factory'
    ? sql`"scope" = 'factory'`
    : target.scope === 'workspace'
      ? sql`"scope" = 'workspace' AND "workspace_id" = ${target.workspace}`
      : sql`"scope" = 'product' AND "product_id" = ${target.product}`

const linesOf = (body: string): number => (body === '' ? 0 : body.replace(/\n$/, '').split('\n').length)

const allowed = async (payload: Payload, who: Who, target: DocumentTarget): Promise<void> => {
  if (target.scope === 'factory') {
    if (who.person.role !== 'admin') {
      throw new NotAllowedToChangeMemory(`Person ${who.person.id} may not change the factory document: ask an Admin.`)
    }
    return
  }
  if (!mayDecide(who.person, target.workspace)) {
    throw new NotAllowedToChangeMemory(`Person ${who.person.id} may not change this document: ask a Bauherr of it.`)
  }
  if (target.scope === 'product') {
    const found = await payload.db.drizzle.execute(
      sql`SELECT "workspace_id" FROM "products" WHERE "id" = ${target.product}`,
    )
    const product = found.rows[0] ? owned.parse(found.rows[0]) : null
    if (product?.workspace_id !== target.workspace) throw new MemoryNotFound('This Product does not exist.')
  }
}

export const documentVersions = async (payload: Payload, target: DocumentTarget): Promise<DocumentVersion[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "body", "author", "reason", "created_at" FROM "memory_document_versions"
    WHERE ${whereOf(target)} ORDER BY "id" DESC`)
  return found.rows.map((raw) => {
    const row = versionRow.parse(raw)
    return { id: row.id, body: row.body, author: row.author, reason: row.reason, at: row.created_at.toISOString() }
  })
}

export const readDocument = async (payload: Payload, target: DocumentTarget): Promise<string> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "body", "author", "reason", "created_at" FROM "memory_document_versions"
    WHERE ${whereOf(target)} ORDER BY "id" DESC LIMIT 1`)
  return found.rows[0] ? versionRow.parse(found.rows[0]).body : ''
}

export const saveDocument = async (
  payload: Payload,
  who: Who,
  target: DocumentTarget,
  body: string,
  reason: DocumentReason = 'edited',
): Promise<DocumentVersion> => {
  await allowed(payload, who, target)
  const lines = linesOf(body)
  if (lines > DOCUMENT_MAX_LINES) {
    throw new MemoryInvalid(
      `The document has ${lines} lines, ${lines - DOCUMENT_MAX_LINES} too many: keep it to ${DOCUMENT_MAX_LINES}.`,
    )
  }
  const workspace = target.scope === 'factory' ? null : target.workspace
  const product = target.scope === 'product' ? target.product : null
  const saved = await payload.db.drizzle.execute(sql`
    INSERT INTO "memory_document_versions" ("workspace_id", "product_id", "scope", "body", "author", "reason")
    VALUES (${workspace}, ${product}, ${target.scope}, ${body}, ${who.person.id}, ${reason})
    RETURNING "id", "body", "author", "reason", "created_at"`)
  const row = versionRow.parse(saved.rows[0])
  return { id: row.id, body: row.body, author: row.author, reason: row.reason, at: row.created_at.toISOString() }
}

export const selectDocumentParts = async (
  payload: Payload,
  where: { workspace: number; product: number },
  stage: MemoryStage,
): Promise<MemoryPart[]> => {
  const targets: DocumentTarget[] = [
    { scope: 'factory' },
    { scope: 'workspace', workspace: where.workspace },
    { scope: 'product', ...where },
  ]
  const parts = await Promise.all(
    targets.map(async (target) => ({
      scope: target.scope,
      text: partsFor(await readDocument(payload, target), stage),
    })),
  )
  return parts.filter((part) => part.text !== '')
}
