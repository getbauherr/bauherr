import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { defineModule } from '../../core/module'
import { criterionSchema, PREVIEW_MAX, riskSchema, SHAPE_MAX } from '../../core/record/schema'

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
  shape: z.string().trim().max(SHAPE_MAX).default(''),
  flow: z.string().trim().max(SHAPE_MAX).default(''),
})

const hasChangedLine = (shape: string): boolean => /^[+-]/m.test(shape)

export const brief = defineModule({
  stage: 'brief',
  role: 'builder',
  writes: ['goal', 'criteria', 'outOfScope', 'visible', 'risk', 'decisions', 'plan', 'shape', 'flow'],
  resultSchema,
  check: async (tx, run, result) => {
    const shapeProblems = hasChangedLine(result.shape) ? [] : [{ path: 'shape', message: NO_SHAPE }]
    if (!result.visible) return shapeProblems
    const worked = await tx.db.drizzle.execute(sql`
      SELECT coalesce(p."executor", 'session') AS executor FROM "records" r
      JOIN "products" p ON p."id" = r."product_id" WHERE r."id" = ${run.recordId}`)
    if (worked.rows[0]?.executor === 'runner') return shapeProblems
    const found = await tx.db.drizzle.execute(sql`
      SELECT 1 FROM "attachments" WHERE "run_id" = ${run.id} AND "kind" = 'mockup' AND "content" IS NOT NULL LIMIT 1`)
    const noMockup = { path: 'visible', message: NO_MOCKUP }
    return found.rows.length > 0 ? shapeProblems : [...shapeProblems, noMockup]
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
      shape: result.shape,
      flow: result.flow,
    },
    events: [{ type: 'brief.submitted', data: { runId: String(run.id) } }],
  }),
})
