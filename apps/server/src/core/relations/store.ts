import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { Edge } from './rules'
import { RELATION_TYPES, type RelationType } from './types'

const count = z.coerce.number()
const edgeRow = z.object({ from_item_id: count, to_item_id: count, type: z.string() })
const itemRow = z.object({ id: count, number: count, repo: z.string(), workspace_id: count })
const blockerRow = z.object({ number: count })

export type ItemFacts = { id: number; number: number; repo: string; workspace: number }

const toEdge = (row: unknown): Edge => {
  const parsed = edgeRow.parse(row)
  return { from: parsed.from_item_id, to: parsed.to_item_id, type: parsed.type }
}

export const loadEdges = async (payload: Payload, workspace: number, type: string): Promise<Edge[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "from_item_id", "to_item_id", "type" FROM "ticket_relations"
    WHERE "workspace_id" = ${workspace} AND "type" = ${type}`)
  return result.rows.map(toEdge)
}

export const edgesOfItem = async (payload: Payload, item: number): Promise<Edge[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "from_item_id", "to_item_id", "type" FROM "ticket_relations"
    WHERE "from_item_id" = ${item} OR "to_item_id" = ${item} ORDER BY "id"`)
  return result.rows.map(toEdge)
}

export const insertEdge = async (payload: Payload, workspace: number, edge: Edge): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    INSERT INTO "ticket_relations" ("workspace_id", "from_item_id", "to_item_id", "type", "updated_at", "created_at")
    VALUES (${workspace}, ${edge.from}, ${edge.to}, ${edge.type}, now(), now())
    ON CONFLICT ("from_item_id", "to_item_id", "type") DO NOTHING`)
}

export const deleteEdge = async (payload: Payload, edge: Edge): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    DELETE FROM "ticket_relations"
    WHERE "from_item_id" = ${edge.from} AND "to_item_id" = ${edge.to} AND "type" = ${edge.type}`)
}

export const itemFacts = async (payload: Payload, ids: number[]): Promise<Map<number, ItemFacts>> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "number", "repo", "workspace_id" FROM "mirror_items"
    WHERE "id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
  const facts = new Map<number, ItemFacts>()
  for (const row of result.rows) {
    const parsed = itemRow.parse(row)
    facts.set(parsed.id, { id: parsed.id, number: parsed.number, repo: parsed.repo, workspace: parsed.workspace_id })
  }
  return facts
}

export const itemsByNumber = async (
  payload: Payload,
  workspace: number,
  repo: string,
  numbers: number[],
): Promise<Map<number, number>> => {
  if (numbers.length === 0) return new Map()
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "number", "repo", "workspace_id" FROM "mirror_items"
    WHERE "workspace_id" = ${workspace} AND "repo" = ${repo} AND "kind" = 'issue'
      AND "number" IN (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)})`)
  return new Map(result.rows.map((row) => itemRow.parse(row)).map((row) => [row.number, row.id]))
}

export const openBlockers = async (
  payload: Payload,
  item: number,
  types: readonly RelationType[] = RELATION_TYPES,
): Promise<number[]> => {
  const keys = types.filter((type) => type.blocksWork).map((type) => type.key)
  if (keys.length === 0) return []
  const result = await payload.db.drizzle.execute(sql`
    SELECT b."number" FROM "ticket_relations" r
    JOIN "mirror_items" b ON b."id" = r."from_item_id" AND b."state" = 'open' AND b."gone_at" IS NULL
    WHERE r."to_item_id" = ${item} AND r."type" IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
    ORDER BY b."number"`)
  return result.rows.map((row) => blockerRow.parse(row).number)
}

export const isBlocked = async (
  payload: Payload,
  item: number,
  types: readonly RelationType[] = RELATION_TYPES,
): Promise<boolean> => (await openBlockers(payload, item, types)).length > 0
