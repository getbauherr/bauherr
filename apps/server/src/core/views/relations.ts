import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export type RelatedTicket = { number: number; title: string; stage: string; recordId: number | null }
export type Parts = { done: number; total: number; tickets: RelatedTicket[] }
export type CardRelations = {
  blocks: RelatedTicket[]
  blockedBy: RelatedTicket[]
  parent: (RelatedTicket & { parts: Parts }) | null
  parts: Parts | null
}

export type RelationEdge = { from: number; to: number; type: 'blocks' | 'part-of' }
export type RelationItem = {
  id: number
  number: number
  title: string
  open: boolean
  gone: boolean
  stage: string | null
  recordId: number | null
}

const itemJson = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  gone: z.boolean(),
  record: z.number().nullable(),
  stage: z.string().nullable(),
})
const edgeRow = z.object({ type: z.enum(['blocks', 'part-of']), from_item: itemJson, to_item: itemJson })

export const stageWord = (item: Pick<RelationItem, 'open' | 'stage'>): string => {
  if (!item.open) return 'Closed'
  return item.stage === null ? 'Not on the board' : item.stage.charAt(0).toUpperCase() + item.stage.slice(1)
}

const refOf = (item: RelationItem): RelatedTicket => ({
  number: item.number,
  title: item.title,
  stage: stageWord(item),
  recordId: item.recordId,
})

const byNumber = (a: RelatedTicket, b: RelatedTicket): number => a.number - b.number

const downstream = (start: number, blocked: Map<number, number[]>, items: Map<number, RelationItem>): number[] => {
  const seen = new Set([start])
  const queue = [start]
  for (const id of queue) {
    for (const next of blocked.get(id) ?? []) {
      if (seen.has(next) || !items.get(next)?.open) continue
      seen.add(next)
      queue.push(next)
    }
  }
  seen.delete(start)
  return [...seen]
}

const group = (edges: RelationEdge[], type: RelationEdge['type'], key: 'from' | 'to'): Map<number, number[]> => {
  const other = key === 'from' ? 'to' : 'from'
  const grouped = new Map<number, number[]>()
  for (const edge of edges.filter((e) => e.type === type)) {
    grouped.set(edge[key], [...(grouped.get(edge[key]) ?? []), edge[other]])
  }
  return grouped
}

const openRefs = (ids: number[], items: Map<number, RelationItem>): RelatedTicket[] =>
  ids
    .map((id) => items.get(id))
    .filter((item): item is RelationItem => item?.open === true)
    .map(refOf)
    .sort(byNumber)

const partsOf = (ids: number[], items: Map<number, RelationItem>): Parts => {
  const present = ids.flatMap((id) => items.get(id) ?? []).filter((item) => !item.gone)
  return {
    done: present.filter((item) => !item.open || item.stage === 'done').length,
    total: present.length,
    tickets: present.map(refOf).sort(byNumber),
  }
}

type Graph = {
  items: Map<number, RelationItem>
  blocked: Map<number, number[]>
  blockers: Map<number, number[]>
  parents: Map<number, number[]>
  children: Map<number, number[]>
}

const relationsOf = (item: RelationItem, graph: Graph): CardRelations => {
  const { items, blocked, blockers, parents, children } = graph
  const parentItem = items.get(parents.get(item.id)?.[0] ?? -1)
  const own = children.get(item.id)
  return {
    blocks: item.open ? openRefs(downstream(item.id, blocked, items), items) : [],
    blockedBy: openRefs(blockers.get(item.id) ?? [], items),
    parent: parentItem ? { ...refOf(parentItem), parts: partsOf(children.get(parentItem.id) ?? [], items) } : null,
    parts: own ? partsOf(own, items) : null,
  }
}

const isRelated = (r: CardRelations): boolean =>
  r.blocks.length > 0 || r.blockedBy.length > 0 || r.parts !== null || r.parent !== null

export const relationsByRecord = (
  edges: RelationEdge[],
  items: Map<number, RelationItem>,
): Map<number, CardRelations> => {
  const graph = {
    items,
    blocked: group(edges, 'blocks', 'from'),
    blockers: group(edges, 'blocks', 'to'),
    parents: group(edges, 'part-of', 'from'),
    children: group(edges, 'part-of', 'to'),
  }
  const result = new Map<number, CardRelations>()
  for (const item of items.values()) {
    const relations = relationsOf(item, graph)
    if (item.recordId !== null && isRelated(relations)) result.set(item.recordId, relations)
  }
  return result
}

const toItem = (json: z.infer<typeof itemJson>): RelationItem => ({
  id: json.id,
  number: json.number,
  title: json.title,
  open: json.state === 'open' && !json.gone,
  gone: json.gone,
  stage: json.stage,
  recordId: json.record,
})

const described = (mirror: string, record: string) =>
  sql.raw(`jsonb_build_object('id', ${mirror}."id", 'number', ${mirror}."number", 'title', ${mirror}."title",
    'state', ${mirror}."state", 'gone', ${mirror}."gone_at" IS NOT NULL, 'record', ${record}."id",
    'stage', ${record}."stage")`)

export const loadRelations = async (payload: Payload, workspace: number): Promise<Map<number, CardRelations>> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT e."type", ${described('f', 'fr')} AS from_item, ${described('t', 'tr')} AS to_item
    FROM "ticket_relations" e
    JOIN "mirror_items" f ON f."id" = e."from_item_id"
    JOIN "mirror_items" t ON t."id" = e."to_item_id"
    LEFT JOIN "records" fr ON fr."workspace_id" = f."workspace_id" AND fr."source_repo" = f."repo"
      AND fr."source_number" = f."number"
    LEFT JOIN "records" tr ON tr."workspace_id" = t."workspace_id" AND tr."source_repo" = t."repo"
      AND tr."source_number" = t."number"
    WHERE e."workspace_id" = ${workspace} AND e."type" IN ('blocks', 'part-of')`)
  const rows = result.rows.map((row) => edgeRow.parse(row))
  const items = new Map<number, RelationItem>()
  for (const row of rows) {
    for (const json of [row.from_item, row.to_item]) items.set(json.id, toItem(json))
  }
  const edges = rows.map((row) => ({ from: row.from_item.id, to: row.to_item.id, type: row.type }))
  return relationsByRecord(edges, items)
}
