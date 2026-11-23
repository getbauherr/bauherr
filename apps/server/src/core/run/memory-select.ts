import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { acceptedCheck } from '../memory-check'
import { anyWord, sharedWords, sharesEnough } from '../mirror/match'
import { WHY, type MemoryStage, type Why } from '../memory'

export const STATEMENT_LIMIT = 5

type Wanted = {
  product: number
  record: number
  stage: MemoryStage
  areas: string[]
  words: string[]
}

export type Selected = { ids: number[]; reasons: Record<string, Why> }

const row = z.object({ id: z.number(), why: z.enum(WHY) })
const handed = (stage: MemoryStage) => sql`s."stages" @> ${JSON.stringify([stage])}::jsonb`

const standing = async (payload: Payload, w: Wanted) => {
  const areas = w.areas.map((area) => sql`${area}`)
  const area = areas.length > 0 ? sql`s."area" IN (${sql.join(areas, sql`, `)})` : sql`false`
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."id", s."applies" AS why FROM "statements" s
    WHERE s."product_id" = ${w.product} AND s."scope" = 'product' AND NOT s."off" AND NOT ${acceptedCheck}
      AND ${handed(w.stage)}
      AND (s."applies" = 'always' OR (s."applies" = 'area' AND ${area}))
    ORDER BY s."applies", s."id"`)
  return found.rows.map((raw) => row.parse(raw))
}

const fitting = async (payload: Payload, w: Wanted) => {
  if (w.words.length === 0) return []
  const vector = sql`to_tsvector('simple', s."text")`
  const shared = sharedWords(vector, w.words)
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."id", 'fit' AS why FROM "statements" s
    WHERE s."product_id" = ${w.product} AND NOT s."off" AND NOT ${acceptedCheck} AND s."applies" = 'fit'
      AND ${handed(w.stage)}
      AND (s."record_id" = ${w.record} OR s."scope" = 'product')
      AND ${vector} @@ ${anyWord(w.words)} AND ${sharesEnough(vector, w.words)}
    ORDER BY ${shared} DESC, ts_rank(${vector}, ${anyWord(w.words)}) DESC, s."created_at" DESC, s."id" DESC
    LIMIT ${STATEMENT_LIMIT}`)
  return found.rows.map((raw) => row.parse(raw))
}

export const selectMemories = async (payload: Payload, wanted: Wanted): Promise<Selected> => {
  const chosen = [...(await standing(payload, wanted)), ...(await fitting(payload, wanted))]
  const unique = chosen.filter((item, at) => chosen.findIndex((other) => other.id === item.id) === at)
  return { ids: unique.map((item) => item.id), reasons: Object.fromEntries(unique.map((i) => [String(i.id), i.why])) }
}
