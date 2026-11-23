import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { defineModule } from '../../core/module'
import { criterionSchema, riskSchema } from '../../core/record/schema'

const text = (max: number) => z.string().trim().min(1).max(max)

const NO_MOCKUP =
  'A user will see this change, but the run attached no mockup: ' +
  'attach one per changed screen with attach_proof (kind mockup), then submit again.'

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
        options: z.array(z.object({ id: text(40), label: text(80) })).min(2).max(4),
        recommended: text(40),
      }),
    )
    .max(12),
  plan: z.array(text(160)).max(7),
})

export const brief = defineModule({
  stage: 'brief',
  role: 'builder',
  writes: ['goal', 'criteria', 'outOfScope', 'visible', 'risk', 'decisions', 'plan'],
  resultSchema,
  check: async (tx, run, result) => {
    if (!result.visible) return []
    const worked = await tx.db.drizzle.execute(sql`
      SELECT coalesce(p."executor", 'session') AS executor FROM "records" r
      JOIN "products" p ON p."id" = r."product_id" WHERE r."id" = ${run.recordId}`)
    if (worked.rows[0]?.executor === 'runner') return []
    const found = await tx.db.drizzle.execute(sql`
      SELECT 1 FROM "attachments" WHERE "run_id" = ${run.id} AND "kind" = 'mockup' AND "content" IS NOT NULL LIMIT 1`)
    return found.rows.length > 0 ? [] : [{ path: 'visible', message: NO_MOCKUP }]
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
    },
    events: [{ type: 'brief.submitted', data: { runId: String(run.id) } }],
  }),
})
