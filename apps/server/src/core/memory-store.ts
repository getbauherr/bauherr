import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { inLockedProduct, type Conn } from './conn'
import { mayDecide } from './decide'
import {
  ALWAYS_MAX,
  MemoryInvalid,
  MemoryNotFound,
  NotAllowedToChangeMemory,
  type Applies,
  type MemoryInput,
  type Who,
} from './memory'
import type { StatementScope } from './statement-scope'

type Placement = { scope: StatementScope; applies: Applies; area: string | null }

const placementOf = (input: MemoryInput, hasTicket: boolean): Placement => {
  if (input.reach === 'ticket') {
    if (!hasTicket) throw new MemoryInvalid('This memory has no ticket: pick another Applies to.')
    return { scope: 'ticket', applies: 'fit', area: null }
  }
  if (input.reach === 'area') {
    if (!input.area) throw new MemoryInvalid('Pick the area of the code this memory applies to.')
    return { scope: 'product', applies: 'area', area: input.area }
  }
  return { scope: 'product', applies: input.reach, area: null }
}

const allowed = (who: Who): void => {
  if (!mayDecide(who.person, who.workspace)) {
    throw new NotAllowedToChangeMemory(`Person ${who.person.id} may not change memory: ask a Bauherr of it.`)
  }
}

const idRow = z.object({ id: z.number() })
const ownRow = z.object({
  product_id: z.number(),
  record_id: z.number().nullable(),
  scope: z.string(),
  applies: z.string(),
  off: z.boolean(),
})

const ownOf = async (tx: Conn, f: { workspace: number; id: number }) => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT "product_id", "record_id", "scope", "applies", "off" FROM "statements"
    WHERE "id" = ${f.id} AND "workspace_id" = ${f.workspace}`)
  if (!found.rows[0]) throw new MemoryNotFound(`Memory ${f.id} is not in this Workspace: check the id.`)
  return ownRow.parse(found.rows[0])
}

const withinAlwaysLimit = async (tx: Conn, product: number, except: number): Promise<void> => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT "id" FROM "statements"
    WHERE "product_id" = ${product} AND "scope" = 'product' AND "applies" = 'always' AND NOT "off"
      AND "id" <> ${except}`)
  if (found.rows.length >= ALWAYS_MAX) {
    throw new MemoryInvalid(
      `A Product keeps at most ${ALWAYS_MAX} memories for every ticket: switch one off first.`,
    )
  }
}

const knownArea = async (payload: Payload, f: { workspace: number; product: number }, area: string | null) => {
  if (area === null) return
  const found = await payload.db.drizzle.execute(sql`
    SELECT "risk_areas" FROM "products" WHERE "id" = ${f.product} AND "workspace_id" = ${f.workspace}`)
  const areas = z.array(z.string()).nullable().parse(found.rows[0]?.risk_areas) ?? []
  if (!areas.includes(area)) throw new MemoryInvalid(`${area} is not a risk area of this Product: pick one of them.`)
}

const productOf = async (payload: Payload, f: { workspace: number; product: number }): Promise<void> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "products" WHERE "id" = ${f.product} AND "workspace_id" = ${f.workspace}`)
  if (!found.rows[0]) throw new MemoryNotFound(`Product ${f.product} is not in this Workspace: check the id.`)
}

export const addMemory = async (
  payload: Payload,
  who: Who,
  f: { product: number; input: MemoryInput },
): Promise<number> => {
  allowed(who)
  const at = { workspace: who.workspace, product: f.product }
  await productOf(payload, at)
  const place = placementOf(f.input, false)
  await knownArea(payload, at, place.area)
  return inLockedProduct(payload, f.product, async (tx) => {
    if (place.applies === 'always') await withinAlwaysLimit(tx, f.product, 0)
    const added = await tx.db.drizzle.execute(sql`
      INSERT INTO "statements" ("workspace_id", "product_id", "kind", "scope", "applies", "area", "stages", "text",
        "updated_at", "created_at")
      VALUES (${who.workspace}, ${f.product}, 'written', ${place.scope}, ${place.applies}, ${place.area},
        ${JSON.stringify(f.input.stages)}::jsonb, ${f.input.text}, now(), now())
      RETURNING "id"`)
    return idRow.parse(added.rows[0]).id
  })
}

export const saveMemory = async (payload: Payload, who: Who, f: { id: number; input: MemoryInput }): Promise<void> => {
  allowed(who)
  const own = await ownOf(payload, { workspace: who.workspace, id: f.id })
  const place = placementOf(f.input, own.record_id !== null)
  await knownArea(payload, { workspace: who.workspace, product: own.product_id }, place.area)
  await inLockedProduct(payload, own.product_id, async (tx) => {
    if (place.applies === 'always' && place.scope === 'product' && !own.off) {
      await withinAlwaysLimit(tx, own.product_id, f.id)
    }
    await tx.db.drizzle.execute(sql`
      UPDATE "statements" SET
        "original_text" = CASE WHEN "original_text" IS NULL AND "text" <> ${f.input.text} THEN "text"
          ELSE "original_text" END,
        "text" = ${f.input.text}, "scope" = ${place.scope}, "applies" = ${place.applies}, "area" = ${place.area},
        "stages" = ${JSON.stringify(f.input.stages)}::jsonb, "updated_at" = now()
      WHERE "id" = ${f.id}`)
  })
}

export const setMemoryOff = async (payload: Payload, who: Who, f: { id: number; off: boolean }): Promise<void> => {
  allowed(who)
  const own = await ownOf(payload, { workspace: who.workspace, id: f.id })
  await inLockedProduct(payload, own.product_id, async (tx) => {
    if (!f.off && own.scope === 'product' && own.applies === 'always') {
      await withinAlwaysLimit(tx, own.product_id, f.id)
    }
    await tx.db.drizzle.execute(
      sql`UPDATE "statements" SET "off" = ${f.off}, "updated_at" = now() WHERE "id" = ${f.id}`,
    )
  })
}

export const deleteMemory = async (payload: Payload, who: Who, f: { id: number }): Promise<void> => {
  allowed(who)
  await ownOf(payload, { workspace: who.workspace, id: f.id })
  await payload.db.drizzle.execute(sql`DELETE FROM "statements" WHERE "id" = ${f.id}`)
}
