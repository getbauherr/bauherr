import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from './conn'
import { isRemembered, OWN_ANSWER } from './decisions'
import type { Card } from './fold'
import { STATEMENT_SCOPES, type NoteScope, type StatementScope } from './statement-scope'

export const STATEMENT_MAX = 1000
export const STATEMENT_KINDS = ['answer', 'send-back', 'brief-change', 'guidance'] as const

export type StatementKind = (typeof STATEMENT_KINDS)[number]
export type Statement = { kind: StatementKind; text: string; scope: StatementScope }
export type StoredStatement = Statement & { id: number; record: number; createdAt: string }

type Given = {
  asked: string | null
  choice: string
  note: string
  card: Card | null
  scope?: NoteScope | undefined
}

export const DEFAULT_SCOPE: Record<StatementKind, StatementScope> = {
  answer: 'product',
  'send-back': 'ticket',
  'brief-change': 'ticket',
  guidance: 'ticket',
}

const clip = (text: string): string => text.slice(0, STATEMENT_MAX)

const NOTE_KINDS: Record<string, StatementKind> = {
  'brief/request-changes': 'brief-change',
  'result/send-back': 'send-back',
  'question:agent/back-to-brief': 'brief-change',
  'working/back-to-brief': 'brief-change',
  'question:failed-runs/retry-with-guidance': 'guidance',
}

const answerText = (choice: string, note: string): string => {
  if (choice === OWN_ANSWER) return note
  return note === '' ? choice : `${choice}. ${note}`
}

const made = (kind: StatementKind, text: string, scope: NoteScope | undefined): Statement | null =>
  scope === 'none' ? null : { kind, text: clip(text), scope: scope ?? DEFAULT_SCOPE[kind] }

export const statementOf = ({ asked, choice, note, card, scope }: Given): Statement | null => {
  const kind = NOTE_KINDS[`${asked}/${choice}`]
  if (kind) return made(kind, note, scope)
  if (asked?.startsWith('question:')) {
    if (!isRemembered(asked.slice('question:'.length))) return null
    const question = card?.text ?? asked.slice('question:'.length)
    return made('answer', `${question}: ${answerText(choice, note)}`, scope)
  }
  return note === '' ? null : made('guidance', note, scope)
}

const rowSchema = z.object({
  id: z.coerce.number(),
  record_id: z.coerce.number(),
  kind: z.enum(STATEMENT_KINDS),
  scope: z.enum(STATEMENT_SCOPES),
  text: z.string(),
  created_at: z.coerce.date(),
})

export const storeStatement = async (tx: Conn, recordId: number, statement: Statement): Promise<void> => {
  await tx.db.drizzle.execute(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "scope", "text",
      "updated_at", "created_at")
    SELECT "workspace_id", "product_id", "id", ${statement.kind}, ${statement.scope}, ${statement.text}, now(), now()
    FROM "records" WHERE "id" = ${recordId}`)
}

export const storeGiven = async (tx: Conn, recordId: number, given: Given): Promise<void> => {
  const statement = statementOf(given)
  if (statement) await storeStatement(tx, recordId, statement)
}

export const statementsFor = async (tx: Conn, product: number, limit: number): Promise<StoredStatement[]> => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT "id", "record_id", "kind", "scope", "text", "created_at" FROM "statements"
    WHERE "product_id" = ${product} ORDER BY "id" DESC LIMIT ${limit}`)
  return found.rows.map((row) => {
    const parsed = rowSchema.parse(row)
    const createdAt = parsed.created_at.toISOString()
    const { id, kind, scope, text } = parsed
    return { id, record: parsed.record_id, kind, scope, text, createdAt }
  })
}

export const deleteStatement = async (tx: Conn, f: { workspace: number; product: number; id: number }) => {
  const deleted = await tx.db.drizzle.execute(sql`
    DELETE FROM "statements"
    WHERE "id" = ${f.id} AND "product_id" = ${f.product} AND "workspace_id" = ${f.workspace}
    RETURNING "id"`)
  if (!deleted.rows[0]) throw new Error('That Statement is not in this Product.')
}
