import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from '../conn'
import type { Problem } from '../module'
import type { ProposedRelation, RelationKind } from '../record/schema'
import { checkRelation, type Edge } from './rules'
import { RelationRefused, typeOf } from './types'

export const edgeOf = (kind: RelationKind, self: number, other: number): Edge =>
  kind === 'blocked-by' ? { from: other, to: self, type: 'blocks' } : { from: self, to: other, type: 'part-of' }

const factRow = z.object({ id: z.coerce.number(), number: z.coerce.number() })
const edgeRow = z.object({ from: z.coerce.number(), to: z.coerce.number(), type: z.string() })

export const refusedRelations = async (
  tx: Conn,
  recordId: number,
  relations: ProposedRelation[],
): Promise<Problem[]> => {
  if (relations.length === 0) return []
  const source = await tx.db.drizzle.execute(
    sql`SELECT (r."data"->'source'->>'number')::int AS "number" FROM "records" r WHERE r."id" = ${recordId}`,
  )
  const selfNumber = factRow.pick({ number: true }).parse(source.rows[0]).number
  const numbers = [selfNumber, ...relations.map((r) => r.ticket)].map((n) => sql`${n}`)
  const own = await tx.db.drizzle.execute(sql`
    SELECT m."id", m."number" FROM "records" r JOIN "mirror_items" m
      ON m."workspace_id" = r."workspace_id" AND m."repo" = r."data"->'source'->>'repo' AND m."kind" = 'issue'
    WHERE r."id" = ${recordId} AND m."number" IN (${sql.join(numbers, sql`, `)})`)
  const ids = new Map(own.rows.map((row) => factRow.parse(row)).map((fact) => [fact.number, fact.id]))
  const selfId = ids.get(selfNumber)
  if (selfId === undefined) return []
  const stored = await tx.db.drizzle.execute(sql`
    SELECT e."from_item_id" AS "from", e."to_item_id" AS "to", e."type" FROM "ticket_relations" e
    JOIN "records" r ON r."workspace_id" = e."workspace_id" WHERE r."id" = ${recordId}`)
  const edges = stored.rows.map((row) => edgeRow.parse(row))
  const labelled = await tx.db.drizzle.execute(sql`
    SELECT m."id", m."number" FROM "mirror_items" m JOIN "records" r ON r."workspace_id" = m."workspace_id"
    WHERE r."id" = ${recordId} AND m."id" IN (${sql.join(
      [...new Set([...edges.flatMap((e) => [e.from, e.to]), ...ids.values()])].map((id) => sql`${id}`),
      sql`, `,
    )})`)
  const numberOf = new Map(labelled.rows.map((row) => factRow.parse(row)).map((fact) => [fact.id, fact.number]))
  const label = (id: number) => `#${numberOf.get(id) ?? id}`
  return relations.flatMap((relation, i) => {
    const other = ids.get(relation.ticket)
    if (other === undefined) return []
    const edge = edgeOf(relation.type, selfId, other)
    try {
      if (checkRelation(edge, typeOf(edge.type), edges, label) === 'new') edges.push(edge)
      return []
    } catch (error) {
      if (!(error instanceof RelationRefused)) throw error
      const message = `#${relation.ticket}: ${error.message} Fix or drop this relation.`
      return [{ path: `relations.${i}.ticket`, message }]
    }
  })
}
