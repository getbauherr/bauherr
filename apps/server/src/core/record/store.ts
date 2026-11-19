import { sql } from '@payloadcms/db-postgres'
import type { Conn } from '../conn'
import { z } from 'zod'
import { ACTORS, parseEvent, stageSchema, type Actor, type AppEvent, type Stage } from '../events'
import { CorruptRecord, InvalidPatch, RecordNotFound, VersionConflict } from './errors'
import { checkPatch, checkWrites, type PatchBy } from './guard'
import {
  emptyRecord,
  recordSchema,
  type RecordField,
  type RecordSource,
  type RecordType,
  type TicketRecord,
} from './schema'

export const WAITING_ON = ['owner', 'agents', 'reporter', 'nobody'] as const
export type WaitingOn = (typeof WAITING_ON)[number]

export const cardSchema = z.object({
  card: z.enum(['brief', 'result', 'question']),
  reason: z.string(),
  options: z.array(z.string()),
  seq: z.number().int().min(0),
})
export type StoredCard = z.infer<typeof cardSchema>

export type StoredRecord = {
  id: number
  version: number
  stage: Stage
  waitingOn: WaitingOn
  rank: number
  card: StoredCard | null
  record: TicketRecord
}

export type NewRecord = { workspace: number; product: number; source: RecordSource; type: RecordType }
export type PatchInput = { expectedVersion: number; writes: RecordField[]; patch: Partial<TicketRecord>; by: PatchBy }
export type NewEvent = AppEvent & { actor: Actor; actorId?: string }
export type StoredEvent = AppEvent & {
  id: number
  recordId: number
  actor: Actor
  actorId: string | null
  createdAt: string
}

const rowSchema = z.object({
  id: z.coerce.number(),
  version: z.coerce.number(),
  stage: stageSchema,
  waiting_on: z.enum(WAITING_ON),
  rank: z.coerce.number(),
  card: cardSchema.nullable(),
  data: z.unknown(),
})

const eventRowSchema = z.object({
  id: z.coerce.number(),
  record_id: z.coerce.number(),
  type: z.string(),
  actor: z.enum(ACTORS),
  actor_id: z.string().nullable(),
  data: z.unknown(),
  created_at: z.coerce.date(),
})

const idRowSchema = z.object({ id: z.coerce.number() })

const json = (value: unknown) => JSON.stringify(value)

const describeIssue = (error: z.ZodError): string => {
  const issue = error.issues[0]
  return issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'unknown'
}

const parseRecord = (id: number, data: unknown): TicketRecord => {
  const parsed = recordSchema.safeParse(data)
  if (parsed.success) return parsed.data
  throw new CorruptRecord(`Record ${id} does not parse at ${describeIssue(parsed.error)}: repair the stored data.`)
}

export const readRecord = async (payload: Conn, id: number): Promise<StoredRecord> => {
  const result = await payload.db.drizzle.execute(
    sql`SELECT "id", "version", "stage", "waiting_on", "rank", "card", "data" FROM "records" WHERE "id" = ${id}`,
  )
  const row = result.rows[0]
  if (!row) throw new RecordNotFound(`Record ${id} does not exist: check the id.`)
  const parsed = rowSchema.parse(row)
  return {
    id: parsed.id,
    version: parsed.version,
    stage: parsed.stage,
    waitingOn: parsed.waiting_on,
    rank: parsed.rank,
    card: parsed.card,
    record: parseRecord(id, parsed.data),
  }
}

export const createRecord = async (payload: Conn, input: NewRecord): Promise<StoredRecord> => {
  const { workspace, product, source, type } = input
  const db = payload.db.drizzle
  const inserted = await db.execute(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number",
      "stage", "waiting_on", "rank", "version", "data", "updated_at", "created_at")
    VALUES (${workspace}, ${product}, ${source.forge}, ${source.repo}, ${source.number},
      'intake', 'agents', 0, 1, ${json(emptyRecord(source, type))}::jsonb, now(), now())
    ON CONFLICT ("workspace_id", "source_forge", "source_repo", "source_number") DO NOTHING
    RETURNING "id"`)
  const created = inserted.rows[0]
  if (created) return readRecord(payload, idRowSchema.parse(created).id)
  const existing = await db.execute(sql`
    SELECT "id" FROM "records" WHERE "workspace_id" = ${workspace} AND "source_forge" = ${source.forge}
      AND "source_repo" = ${source.repo} AND "source_number" = ${source.number}`)
  return readRecord(payload, idRowSchema.parse(existing.rows[0]).id)
}

export const patchRecord = async (payload: Conn, id: number, input: PatchInput): Promise<number> => {
  const { expectedVersion, writes, patch, by } = input
  checkWrites(patch, writes)
  const current = await readRecord(payload, id)
  if (current.version !== expectedVersion) {
    throw new VersionConflict(`Record ${id} is at version ${current.version}, not ${expectedVersion}: read it again.`)
  }
  const merged = recordSchema.safeParse({ ...current.record, ...patch })
  if (!merged.success) {
    throw new InvalidPatch(`The patch makes record ${id} invalid at ${describeIssue(merged.error)}: fix that field.`)
  }
  checkPatch(current.record, merged.data, by)
  const updated = await payload.db.drizzle.execute(sql`
    UPDATE "records" SET "data" = ${json(merged.data)}::jsonb, "version" = "version" + 1, "updated_at" = now()
    WHERE "id" = ${id} AND "version" = ${expectedVersion}
    RETURNING "version"`)
  const row = updated.rows[0]
  if (!row) throw new VersionConflict(`Record ${id} changed since version ${expectedVersion}: read it again.`)
  return z.object({ version: z.coerce.number() }).parse(row).version
}

export const setProjection = async (
  payload: Conn,
  id: number,
  projection: { stage: Stage; waitingOn: WaitingOn },
): Promise<void> => {
  const stage = stageSchema.parse(projection.stage)
  const waitingOn = z.enum(WAITING_ON).parse(projection.waitingOn)
  const updated = await payload.db.drizzle.execute(
    sql`UPDATE "records" SET "stage" = ${stage}, "waiting_on" = ${waitingOn}, "updated_at" = now()
      WHERE "id" = ${id} RETURNING "id"`,
  )
  if (!updated.rows[0]) throw new RecordNotFound(`Record ${id} does not exist: check the id.`)
}

export const setCard = async (payload: Conn, id: number, card: StoredCard | null): Promise<void> => {
  const value = card === null ? null : json(cardSchema.parse(card))
  const updated = await payload.db.drizzle.execute(
    sql`UPDATE "records" SET "card" = ${value}::jsonb, "updated_at" = now() WHERE "id" = ${id} RETURNING "id"`,
  )
  if (!updated.rows[0]) throw new RecordNotFound(`Record ${id} does not exist: check the id.`)
}

export const setRank = async (payload: Conn, id: number, rank: number): Promise<void> => {
  const updated = await payload.db.drizzle.execute(
    sql`UPDATE "records" SET "rank" = ${z.number().parse(rank)}, "updated_at" = now()
      WHERE "id" = ${id} RETURNING "id"`,
  )
  if (!updated.rows[0]) throw new RecordNotFound(`Record ${id} does not exist: check the id.`)
}

const toStoredEvent = (row: unknown): StoredEvent => {
  const parsed = eventRowSchema.parse(row)
  return {
    ...parseEvent(parsed),
    id: parsed.id,
    recordId: parsed.record_id,
    actor: parsed.actor,
    actorId: parsed.actor_id,
    createdAt: parsed.created_at.toISOString(),
  }
}

export const appendEvent = async (payload: Conn, recordId: number, event: NewEvent): Promise<StoredEvent> => {
  const valid = parseEvent({ type: event.type, data: event.data })
  const actor = z.enum(ACTORS).parse(event.actor)
  const inserted = await payload.db.drizzle.execute(sql`
    INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "actor_id", "data", "updated_at", "created_at")
    SELECT "workspace_id", "id", ${valid.type}, ${actor}, ${event.actorId ?? null},
      ${json(valid.data)}::jsonb, now(), now()
    FROM "records" WHERE "id" = ${recordId}
    RETURNING "id", "record_id", "type", "actor", "actor_id", "data", "created_at"`)
  const row = inserted.rows[0]
  if (!row) throw new RecordNotFound(`Record ${recordId} does not exist: check the id.`)
  return toStoredEvent(row)
}

export const readEvents = async (payload: Conn, recordId: number): Promise<StoredEvent[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "record_id", "type", "actor", "actor_id", "data", "created_at"
    FROM "events" WHERE "record_id" = ${recordId} ORDER BY "id"`)
  return result.rows.map(toStoredEvent)
}
