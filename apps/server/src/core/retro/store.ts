import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import {
  RETRO_STATES,
  openingSchema,
  outcomeSchema,
  partsSchema,
  type Opening,
  type Outcome,
  type Parts,
  type RetroState,
} from './schema'

export type Retro = {
  id: number
  workspace: number
  product: number
  from: Date
  to: Date
  label: string
  state: RetroState
  agreed: string[]
  opening: Opening | null
  outcome: Outcome | null
  createdBy: string
  at: Date
}
export type Message = { id: number; role: 'assistant' | 'owner'; body: string; parts: Parts | null }
export type NewRetro = {
  workspace: number
  product: number
  from: Date
  to: Date
  label: string
  createdBy: string
  opening: Opening
}

const id = z.coerce.number()
const retroRow = z.object({
  id,
  workspace_id: id,
  product_id: id,
  range_from: z.coerce.date(),
  range_to: z.coerce.date(),
  range_label: z.string(),
  state: z.enum(RETRO_STATES),
  agreed: z.array(z.string()),
  opening: openingSchema.nullable(),
  outcome: outcomeSchema.nullable(),
  created_by: z.string(),
  created_at: z.coerce.date(),
})
const messageRow = z.object({
  id,
  role: z.enum(['assistant', 'owner']),
  body: z.string(),
  parts: partsSchema.nullable(),
})

const COLUMNS = sql`"id", "workspace_id", "product_id", "range_from", "range_to", "range_label", "state", "agreed",
  "opening", "outcome", "created_by", "created_at"`

const retroOf = (raw: unknown): Retro => {
  const row = retroRow.parse(raw)
  return {
    id: row.id,
    workspace: row.workspace_id,
    product: row.product_id,
    from: row.range_from,
    to: row.range_to,
    label: row.range_label,
    state: row.state,
    agreed: row.agreed,
    opening: row.opening,
    outcome: row.outcome,
    createdBy: row.created_by,
    at: row.created_at,
  }
}

const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

export const createRetro = async (payload: Payload, retro: NewRetro): Promise<number> => {
  const made = await payload.db.drizzle.execute(sql`
    INSERT INTO "retros" ("workspace_id", "product_id", "range_from", "range_to", "range_label", "state", "agreed",
      "opening", "created_by")
    VALUES (${retro.workspace}, ${retro.product}, ${retro.from.toISOString()}, ${retro.to.toISOString()},
      ${retro.label}, 'open', '[]'::jsonb, ${json(retro.opening)}, ${retro.createdBy})
    RETURNING "id"`)
  return id.parse(made.rows[0]?.id)
}

export const loadRetro = async (payload: Payload, workspace: number, retro: number): Promise<Retro | null> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT ${COLUMNS} FROM "retros" WHERE "id" = ${retro} AND "workspace_id" = ${workspace}`,
  )
  return found.rows[0] ? retroOf(found.rows[0]) : null
}

export const retrosOfProduct = async (payload: Payload, workspace: number, product: number): Promise<Retro[]> => {
  const found = await payload.db.drizzle.execute(sql`SELECT ${COLUMNS} FROM "retros"
    WHERE "workspace_id" = ${workspace} AND "product_id" = ${product} ORDER BY "id" DESC`)
  return found.rows.map(retroOf)
}

export const addMessage = async (
  payload: Payload,
  retro: Retro,
  message: { role: 'assistant' | 'owner'; body: string; parts?: Parts },
): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    INSERT INTO "retro_messages" ("workspace_id", "retro_id", "role", "body", "parts")
    VALUES (${retro.workspace}, ${retro.id}, ${message.role}, ${message.body},
      ${message.parts ? json(message.parts) : null})`)
}

export const addFirstMessage = async (
  payload: Payload,
  retro: Retro,
  message: { role: 'assistant'; body: string; parts: Parts },
): Promise<void> => {
  await payload.db.drizzle.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM "retros" WHERE "id" = ${retro.id} FOR UPDATE`)
    await tx.execute(sql`
      INSERT INTO "retro_messages" ("workspace_id", "retro_id", "role", "body", "parts")
      SELECT ${retro.workspace}, ${retro.id}, ${message.role}, ${message.body}, ${json(message.parts)}
      WHERE NOT EXISTS (SELECT 1 FROM "retro_messages" WHERE "retro_id" = ${retro.id})`)
  })
}

export const unopenedRetro = async (
  payload: Payload,
  workspace: number,
  product: number,
  label: string,
): Promise<Retro | null> => {
  const found = await payload.db.drizzle.execute(sql`SELECT ${COLUMNS} FROM "retros"
    WHERE "workspace_id" = ${workspace} AND "product_id" = ${product} AND "range_label" = ${label}
      AND "state" = 'open' AND NOT EXISTS (SELECT 1 FROM "retro_messages" WHERE "retro_id" = "retros"."id")
    ORDER BY "id" DESC LIMIT 1`)
  return found.rows[0] ? retroOf(found.rows[0]) : null
}

export const messagesOf = async (payload: Payload, retro: number): Promise<Message[]> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "id", "role", "body", "parts" FROM "retro_messages" WHERE "retro_id" = ${retro} ORDER BY "id"`,
  )
  return found.rows.map((raw) => messageRow.parse(raw))
}

export const saveAgreed = async (payload: Payload, retro: number, agreed: string[]): Promise<void> => {
  await payload.db.drizzle.execute(sql`UPDATE "retros" SET "agreed" = ${json(agreed)}, "updated_at" = now()
    WHERE "id" = ${retro}`)
}

export const saveOutcome = async (
  payload: Payload,
  retro: number,
  outcome: Outcome,
  state: RetroState,
): Promise<void> => {
  await payload.db.drizzle.execute(sql`UPDATE "retros" SET "outcome" = ${json(outcome)}, "state" = ${state},
    "updated_at" = now() WHERE "id" = ${retro}`)
}
