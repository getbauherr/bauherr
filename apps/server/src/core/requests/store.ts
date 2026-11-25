import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from '../conn'
import { TYPES } from '../record/schema'
import { questionSchema } from './questions'

const similar = z.object({ number: z.number(), title: z.string(), url: z.string() })

export const draftData = z.object({
  type: z.enum(TYPES).nullable(),
  typeConfirmed: z.boolean(),
  title: z.string(),
  summary: z.string(),
  fields: z.record(z.string(), z.string()),
  rounds: z.number().int().min(0),
  questions: z.array(questionSchema),
  offered: z.boolean(),
  offer: similar.nullable(),
  joined: similar.nullable(),
  answer: z.string().nullable(),
})

export type DraftData = z.infer<typeof draftData>
export type DraftState = 'open' | 'sent' | 'joined' | 'closed'
export type Draft = {
  conversationId: number
  workspace: number
  product: number
  state: DraftState
  data: DraftData
  issueNumber: number | null
  recordId: number | null
  createdBy: string
}

export const emptyDraft = (): DraftData => ({
  type: null,
  typeConfirmed: false,
  title: '',
  summary: '',
  fields: {},
  rounds: 0,
  questions: [],
  offered: false,
  offer: null,
  joined: null,
  answer: null,
})

const count = z.coerce.number()
const row = z.object({
  conversation_id: count,
  workspace_id: count,
  product_id: count,
  state: z.enum(['open', 'sent', 'joined', 'closed']),
  data: draftData,
  issue_number: count.nullable(),
  record_id: count.nullable(),
  created_by: z.string(),
})

export const createDraft = async (
  db: Conn,
  input: { conversationId: number; workspace: number; product: number; createdBy: string },
): Promise<void> => {
  await db.db.drizzle.execute(sql`
    INSERT INTO "request_drafts" ("workspace_id", "conversation_id", "product_id", "state", "data", "created_by",
      "updated_at", "created_at")
    VALUES (${input.workspace}, ${input.conversationId}, ${input.product}, 'open',
      ${JSON.stringify(emptyDraft())}::jsonb, ${input.createdBy}, now(), now())
    ON CONFLICT ("conversation_id") DO NOTHING`)
}

export const loadDraft = async (db: Conn, conversationId: number, lock = false): Promise<Draft | null> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT "conversation_id", "workspace_id", "product_id", "state", "data", "issue_number", "record_id", "created_by"
    FROM "request_drafts" WHERE "conversation_id" = ${conversationId} ${lock ? sql`FOR UPDATE` : sql``}`)
  if (!found.rows[0]) return null
  const r = row.parse(found.rows[0])
  return {
    conversationId: r.conversation_id,
    workspace: r.workspace_id,
    product: r.product_id,
    state: r.state,
    data: r.data,
    issueNumber: r.issue_number,
    recordId: r.record_id,
    createdBy: r.created_by,
  }
}

export const saveDraft = async (
  db: Conn,
  conversationId: number,
  change: { state?: DraftState; data?: DraftData; issueNumber?: number; recordId?: number },
): Promise<void> => {
  await db.db.drizzle.execute(sql`
    UPDATE "request_drafts" SET
      "state" = coalesce(${change.state ?? null}, "state"),
      "data" = coalesce(${change.data ? JSON.stringify(change.data) : null}::jsonb, "data"),
      "issue_number" = coalesce(${change.issueNumber ?? null}, "issue_number"),
      "record_id" = coalesce(${change.recordId ?? null}, "record_id"),
      "updated_at" = now()
    WHERE "conversation_id" = ${conversationId}`)
}

export type DraftFile = { id: number; name: string; contentType: string; bytes: number }

const fileRow = z.object({ id: count, name: z.string(), content_type: z.string(), byte_size: count })

export const filesOf = async (db: Conn, conversationId: number): Promise<DraftFile[]> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT "id", "name", "content_type", "byte_size" FROM "conversation_files"
    WHERE "conversation_id" = ${conversationId} ORDER BY "id"`)
  return found.rows.map((raw) => {
    const r = fileRow.parse(raw)
    return { id: r.id, name: r.name, contentType: r.content_type, bytes: r.byte_size }
  })
}
