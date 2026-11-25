import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from '../../core/conn'
import type { Problem } from '../../core/module'
import { defineModule } from '../../core/module'
import { refusedRelations } from '../../core/relations/proposal'
import { criterionSchema, PREVIEW_MAX, relationSchema, riskSchema, SHAPE_MAX } from '../../core/record/schema'

const text = (max: number) => z.string().trim().min(1).max(max)

const NO_MOCKUP =
  'A user will see this change, but the run attached no mockup: ' +
  'attach one per changed screen with attach_proof (kind mockup), then submit again.'

const option = z.object({ id: text(40), label: text(80), preview: text(PREVIEW_MAX).optional() })

const NO_SHAPE =
  'The Brief has no shape view: add `shape`, a diff of the tree that changes most with real names, ' +
  'one line each, + for added and - for removed (files, components, calls, state or schema), then submit again.'

const resultSchema = z.object({
  goal: text(300),
  criteria: z.array(criterionSchema.pick({ text: true, verify: true }).strict()).min(3).max(7),
  outOfScope: z.array(text(160)).max(5),
  visible: z.boolean(),
  risk: riskSchema,
  decisions: z
    .array(
      z.object({
        question: text(200),
        options: z.array(option).min(2).max(4),
        recommended: text(40),
      }),
    )
    .max(12),
  plan: z.array(text(160)).max(7),
  relations: z.array(relationSchema).max(5).default([]),
  shape: z.string().trim().max(SHAPE_MAX).default(''),
  flow: z.string().trim().max(SHAPE_MAX).default(''),
})

const UNKNOWN_TICKET = 'is not another ticket of this repository: use a real ticket number or drop the relation.'

const unknownRelations = async (
  tx: Conn,
  recordId: number,
  relations: { ticket: number }[],
): Promise<Problem[]> => {
  if (relations.length === 0) return []
  const numbers = relations.map((r) => sql`${r.ticket}`)
  const known = await tx.db.drizzle.execute(sql`
    SELECT m."number" FROM "records" r JOIN "mirror_items" m
      ON m."workspace_id" = r."workspace_id" AND m."repo" = r."data"->'source'->>'repo' AND m."kind" = 'issue'
    WHERE r."id" = ${recordId} AND m."number" IN (${sql.join(numbers, sql`, `)})
      AND m."number" <> (r."data"->'source'->>'number')::int`)
  const found = new Set(known.rows.map((row) => Number(row.number)))
  return relations.flatMap((r, i) =>
    found.has(r.ticket)
      ? []
      : [{ path: `relations.${i}.ticket`, message: `#${r.ticket} ${UNKNOWN_TICKET}` }],
  )
}

const hasChangedLine = (shape: string): boolean => /^[+-]/m.test(shape)

export const brief = defineModule({
  stage: 'brief',
  role: 'builder',
  writes: ['goal', 'criteria', 'outOfScope', 'visible', 'risk', 'decisions', 'plan', 'relations', 'shape', 'flow'],
  resultSchema,
  check: async (tx, run, result) => {
    const shapeProblems = hasChangedLine(result.shape) ? [] : [{ path: 'shape', message: NO_SHAPE }]
    const unknown = await unknownRelations(tx, run.recordId, result.relations)
    const refused = unknown.length === 0 ? await refusedRelations(tx, run.recordId, result.relations) : []
    const problems = [...shapeProblems, ...unknown, ...refused]
    if (!result.visible) return problems
    const worked = await tx.db.drizzle.execute(sql`
      SELECT coalesce(p."executor", 'session') AS executor FROM "records" r
      JOIN "products" p ON p."id" = r."product_id" WHERE r."id" = ${run.recordId}`)
    if (worked.rows[0]?.executor === 'runner') return problems
    const found = await tx.db.drizzle.execute(sql`
      SELECT 1 FROM "attachments" WHERE "run_id" = ${run.id} AND "kind" = 'mockup' AND "content" IS NOT NULL LIMIT 1`)
    const noMockup = { path: 'visible', message: NO_MOCKUP }
    return found.rows.length > 0 ? problems : [...problems, noMockup]
  },
  apply: (_record, result, run) => ({
    patch: {
      goal: result.goal,
      criteria: result.criteria.map((c, i) => ({ id: `c${i + 1}`, ...c, status: 'open', proof: [] })),
      outOfScope: result.outOfScope,
      visible: result.visible,
      risk: result.risk,
      decisions: result.decisions.map((d, i) => ({ id: `d${i + 1}`, ...d })),
      plan: { steps: result.plan },
      relations: result.relations,
      shape: result.shape,
      flow: result.flow,
    },
    events: [{ type: 'brief.submitted', data: { runId: String(run.id) } }],
  }),
})
