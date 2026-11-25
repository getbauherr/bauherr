import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { Conn } from '../conn'
import { inLockedProduct } from '../conn'
import { UNRELEASED } from './notes-store'
import {
  RUN_STATES,
  newSteps,
  stepSchema,
  ticketRefSchema,
  type ReleaseRun,
  type Step,
  type TicketRef,
} from './run-steps'

const LEASE_MINUTES = 2

const row = z.object({
  id: z.coerce.number(),
  workspace_id: z.coerce.number(),
  product_id: z.coerce.number(),
  version: z.string(),
  sha: z.string(),
  state: z.enum(RUN_STATES),
  steps: z.array(stepSchema),
  body: z.string().nullable(),
  tickets: z.array(ticketRefSchema),
  forge_release: z.string().nullable(),
  failure: z.string().nullable(),
})

const COLUMNS = sql`"id", "workspace_id", "product_id", "version", "sha", "state", "steps", "body", "tickets",
  "forge_release", "failure"`

const toRun = (found: unknown): ReleaseRun => {
  const parsed = row.parse(found)
  return {
    id: parsed.id,
    workspace: parsed.workspace_id,
    product: parsed.product_id,
    version: parsed.version,
    sha: parsed.sha,
    state: parsed.state,
    steps: parsed.steps,
    body: parsed.body ?? '',
    tickets: parsed.tickets,
    forgeRelease: parsed.forge_release,
    failure: parsed.failure,
  }
}

export const readRun = async (payload: Payload, id: number): Promise<ReleaseRun | null> => {
  const found = await payload.db.drizzle.execute(sql`SELECT ${COLUMNS} FROM "product_releases" WHERE "id" = ${id}`)
  return found.rows[0] ? toRun(found.rows[0]) : null
}

export const openRun = async (payload: Payload, product: number): Promise<ReleaseRun | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT ${COLUMNS} FROM "product_releases"
    WHERE "product_id" = ${product} AND "state" IN ('running', 'failed') ORDER BY "id" DESC LIMIT 1`)
  return found.rows[0] ? toRun(found.rows[0]) : null
}

export const runByVersion = async (payload: Payload, product: number, version: string): Promise<ReleaseRun | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT ${COLUMNS} FROM "product_releases" WHERE "product_id" = ${product} AND "version" = ${version}`)
  return found.rows[0] ? toRun(found.rows[0]) : null
}

export const runningIds = async (payload: Payload): Promise<number[]> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "id" FROM "product_releases" WHERE "state" = 'running' ORDER BY "id"`,
  )
  return found.rows.map((entry) => z.coerce.number().parse(entry.id))
}

export type NewRun = {
  workspace: number
  product: number
  version: string
  sha: string
  body: string
  tickets: TicketRef[]
}

export const createRun = (payload: Payload, input: NewRun, check: (tx: Conn) => Promise<void>): Promise<ReleaseRun> =>
  inLockedProduct(payload, input.product, async (tx) => {
    await check(tx)
    const found = await tx.db.drizzle.execute(sql`
      INSERT INTO "product_releases" ("workspace_id", "product_id", "version", "sha", "state", "steps", "body",
        "tickets", "updated_at", "created_at")
      VALUES (${input.workspace}, ${input.product}, ${input.version}, ${input.sha}, 'running',
        ${JSON.stringify(newSteps())}::jsonb, ${input.body}, ${JSON.stringify(input.tickets)}::jsonb, now(), now())
      RETURNING ${COLUMNS}`)
    await tx.db.drizzle.execute(sql`
      INSERT INTO "release_notes" ("workspace_id", "product_id", "version", "items", "internal_count", "generated_at",
        "updated_at", "created_at")
      SELECT "workspace_id", "product_id", ${input.version}, "items", "internal_count", "generated_at", now(), now()
      FROM "release_notes" WHERE "product_id" = ${input.product} AND "version" = ${UNRELEASED}
      ON CONFLICT ("version", "product_id") DO NOTHING`)
    return toRun(found.rows[0])
  })

export const claim = async (payload: Payload, id: number): Promise<boolean> => {
  const found = await payload.db.drizzle.execute(sql`
    UPDATE "product_releases" SET "claimed_at" = now()
    WHERE "id" = ${id} AND "state" = 'running'
      AND ("claimed_at" IS NULL OR "claimed_at" < now() - ${LEASE_MINUTES} * interval '1 minute')
    RETURNING "id"`)
  return found.rows.length > 0
}

export const unclaim = async (payload: Payload, id: number): Promise<void> => {
  await payload.db.drizzle.execute(sql`UPDATE "product_releases" SET "claimed_at" = NULL WHERE "id" = ${id}`)
}

export const saveRun = async (
  payload: Payload,
  id: number,
  change: { steps: Step[]; state: ReleaseRun['state']; failure: string | null; forgeRelease: string | null },
): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "product_releases" SET "steps" = ${JSON.stringify(change.steps)}::jsonb, "state" = ${change.state},
      "failure" = ${change.failure}, "forge_release" = ${change.forgeRelease}, "updated_at" = now()
    WHERE "id" = ${id}`)
}

export const dropUnreleasedNotes = async (payload: Payload, product: number): Promise<void> => {
  await payload.db.drizzle.execute(
    sql`DELETE FROM "release_notes" WHERE "product_id" = ${product} AND "version" = ${UNRELEASED}`,
  )
}

export const abandon = async (payload: Payload, id: number): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "product_releases" SET "state" = 'abandoned', "updated_at" = now()
    WHERE "id" = ${id} AND "state" = 'failed'`)
}
