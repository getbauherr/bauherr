import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { advance, type AdvanceDeps } from './engine'
import { runEffects } from './effects'
import { deferredSchema } from './events'
import { fold, foldOptions } from './lifecycle'
import type { Effect } from './module'
import { readEvents } from './record/store'

const pendingRow = z.object({ record_id: z.coerce.number(), data: deferredSchema })
const recordRow = z.object({ id: z.coerce.number(), live: z.boolean() })

const pendingOf = async (payload: Payload, where: ReturnType<typeof sql>) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT e."record_id", e."data" FROM "events" e JOIN "records" r ON r."id" = e."record_id"
    JOIN "products" p ON p."id" = r."product_id"
    WHERE e."type" = 'forge.write.deferred' AND ${where}
      AND NOT EXISTS (SELECT 1 FROM "events" d WHERE d."record_id" = e."record_id" AND d."type" = 'forge.write.done'
        AND d."data"->>'kind' = e."data"->>'kind' AND d."id" > e."id")
    ORDER BY e."id"`)
  return result.rows.map((row) => pendingRow.parse(row))
}

const recordsOf = async (payload: Payload, product: number) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", ("waiting_on" <> 'nobody' OR "parked" IS NOT NULL) AS live FROM "records"
    WHERE "product_id" = ${product} ORDER BY "id"`)
  return result.rows.map((row) => recordRow.parse(row))
}

const effectOf = (data: z.infer<typeof deferredSchema>): Effect => {
  switch (data.kind) {
    case 'question':
      return { kind: 'question', body: data.body }
    case 'close':
      return { kind: 'close', reason: data.reason }
    case 'review':
      return { kind: 'review', pr: data.target.number, body: data.body }
  }
}

const send = async (deps: AdvanceDeps, recordId: number, data: z.infer<typeof deferredSchema>): Promise<void> => {
  if (data.kind === 'close' && !(await deps.configFor(recordId)).autoClose) return
  await runEffects(deps, recordId, [effectOf(data)])
}

const workStarted = async (deps: AdvanceDeps, recordId: number): Promise<boolean> => {
  const events = await readEvents(deps.payload, recordId)
  return fold(events, foldOptions(await deps.configFor(recordId))).brief === 'approved'
}

export const sendDeferred = async (deps: AdvanceDeps, product: number): Promise<void> => {
  for (const { record_id, data } of await pendingOf(deps.payload, sql`r."product_id" = ${product}`)) {
    await send(deps, record_id, data)
  }
  const records = await recordsOf(deps.payload, product)
  for (const { id } of records.filter((record) => record.live)) await advance(id, deps)
  for (const { id } of records) {
    if (await workStarted(deps, id)) await runEffects(deps, id, [{ kind: 'status' }])
  }
}

export const sendHeld = async (deps: AdvanceDeps): Promise<void> => {
  const free = sql`p."state" = 'active' AND e."data"->>'held' = 'true' AND NOT EXISTS (
    SELECT 1 FROM "ticket_sources" s JOIN "connections" c ON c."id" = s."connection_id"
    WHERE s."product_id" = r."product_id"
      AND (c."forge_limits"->>'pausedUntil')::timestamptz > ${deps.now.toISOString()}::timestamptz)`
  for (const { record_id, data } of await pendingOf(deps.payload, free)) {
    await send(deps, record_id, data)
  }
}
