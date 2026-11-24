import { sql } from '@payloadcms/db-postgres'
import { createRecord } from '../../src/core/record/store'
import type { CoreDb } from './db'
import { source } from './fixtures'

export const MINUTE = 60_000
export const DAY = 24 * 60 * MINUTE

export type SeedRun = { status?: string; cost?: number }
export type SeedTicket = {
  doneAt: Date
  startedMinutesBefore?: number
  rounds?: number
  sendBacks?: number
  questions?: number
  runs?: SeedRun[]
  findings?: ('spec' | 'standards' | 'security')[]
  product?: number
}

let number = 5000

const repeated = (n: number, ...types: string[]): string[] => Array.from({ length: n }, () => types).flat()

const eventTypes = (ticket: SeedTicket): string[] => {
  const sendBacks = ticket.sendBacks ?? 0
  return [
    'intake.accepted',
    ...repeated(ticket.rounds ?? 0, 'verify.changes'),
    ...repeated(ticket.questions ?? 0, 'question.asked'),
    ...repeated(sendBacks, 'result.sent-back', 'result.accepted'),
    ...repeated(sendBacks === 0 ? 1 : 0, 'result.accepted'),
  ]
}

const insertEvents = async (db: CoreDb, record: number, ticket: SeedTicket): Promise<void> => {
  const types = eventTypes(ticket)
  const end = ticket.doneAt.getTime()
  const begin = end - (ticket.startedMinutesBefore ?? 60) * MINUTE
  const step = (end - begin) / Math.max(1, types.length - 1)
  const rows = types.map((type, index) => {
    const at = new Date(index === types.length - 1 ? end : begin + step * index).toISOString()
    return sql`(${db.workspace}, ${record}, ${type}, 'factory', '{}'::jsonb, ${at}, now())`
  })
  await db.payload.db.drizzle.execute(sql`INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data",
    "created_at", "updated_at") VALUES ${sql.join(rows, sql`, `)}`)
}

const insertRun = async (db: CoreDb, record: number, at: Date, run: SeedRun, index: number): Promise<void> => {
  const source = run.cost === undefined ? null : 'gateway'
  await db.payload.db.drizzle.execute(sql`INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role",
    "status", "fingerprint", "attempt", "steps", "cost_usd", "cost_source", "created_at", "updated_at")
    VALUES (${db.workspace}, ${record}, 'build', 'builder', ${run.status ?? 'submitted'}, ${`fp-${record}-${index}`},
      0, '[]'::jsonb, ${run.cost ?? null}, ${source}, ${at.toISOString()}, now())`)
}

export const seedTicket = async (db: CoreDb, ticket: SeedTicket): Promise<number> => {
  const record = await createRecord(db.payload, {
    workspace: db.workspace,
    product: ticket.product ?? db.product,
    source: { ...source, number: number++ },
    type: 'bug',
  })
  await insertEvents(db, record.id, ticket)
  for (const [index, run] of (ticket.runs ?? []).entries()) await insertRun(db, record.id, ticket.doneAt, run, index)
  const findings = (ticket.findings ?? []).map((axis, index) => ({ id: `f${index + 1}`, axis }))
  await db.payload.db.drizzle.execute(sql`UPDATE "records"
    SET "data" = jsonb_set("data", '{findings}', ${JSON.stringify(findings)}::jsonb) WHERE "id" = ${record.id}`)
  return record.id
}
