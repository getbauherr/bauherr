import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from './conn'
import { isRemembered } from './decisions'
import type { Card } from './fold'

export const STATEMENT_MAX = 1000
export const STATEMENT_KINDS = ['answer', 'send-back', 'brief-change', 'guidance'] as const

export type StatementKind = (typeof STATEMENT_KINDS)[number]
export type Statement = { kind: StatementKind; text: string }
export type StoredStatement = Statement & { id: number; record: number; createdAt: string }

type Given = { asked: string | null; choice: string; note: string; card: Card | null }

const clip = (text: string): string => text.slice(0, STATEMENT_MAX)

const NOTE_KINDS: Record<string, StatementKind> = {
  'brief/request-changes': 'brief-change',
  'result/send-back': 'send-back',
  'question:failed-runs/retry-with-guidance': 'guidance',
}

export const statementOf = ({ asked, choice, note, card }: Given): Statement | null => {
  const kind = NOTE_KINDS[`${asked}/${choice}`]
  if (kind) return { kind, text: clip(note) }
  if (asked?.startsWith('question:')) {
    if (!isRemembered(asked.slice('question:'.length))) return null
    const question = card?.text ?? asked.slice('question:'.length)
    return { kind: 'answer', text: clip(note === '' ? `${question}: ${choice}` : `${question}: ${choice}. ${note}`) }
  }
  return note === '' ? null : { kind: 'guidance', text: clip(note) }
}

const rowSchema = z.object({
  id: z.coerce.number(),
  record_id: z.coerce.number(),
  kind: z.enum(STATEMENT_KINDS),
  text: z.string(),
  created_at: z.coerce.date(),
})

export const storeStatement = async (tx: Conn, recordId: number, statement: Statement): Promise<void> => {
  await tx.db.drizzle.execute(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "text", "updated_at", "created_at")
    SELECT "workspace_id", "product_id", "id", ${statement.kind}, ${statement.text}, now(), now()
    FROM "records" WHERE "id" = ${recordId}`)
}

export const storeGiven = async (tx: Conn, recordId: number, given: Given): Promise<void> => {
  const statement = statementOf(given)
  if (statement) await storeStatement(tx, recordId, statement)
}

export const statementsFor = async (tx: Conn, product: number, limit: number): Promise<StoredStatement[]> => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT "id", "record_id", "kind", "text", "created_at" FROM "statements"
    WHERE "product_id" = ${product} ORDER BY "id" DESC LIMIT ${limit}`)
  return found.rows.map((row) => {
    const parsed = rowSchema.parse(row)
    const createdAt = parsed.created_at.toISOString()
    return { id: parsed.id, record: parsed.record_id, kind: parsed.kind, text: parsed.text, createdAt }
  })
}
