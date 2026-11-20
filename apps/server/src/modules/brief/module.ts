import { z } from 'zod'
import { defineModule } from '../../core/module'
import { criterionSchema, riskSchema } from '../../core/record/schema'

const text = (max: number) => z.string().trim().min(1).max(max)

const resultSchema = z.object({
  goal: text(300),
  criteria: z.array(criterionSchema.pick({ text: true, verify: true }).strict()).min(3).max(7),
  outOfScope: z.array(text(160)).max(5),
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
  writes: ['goal', 'criteria', 'outOfScope', 'risk', 'decisions', 'plan'],
  resultSchema,
  apply: (_record, result, run) => ({
    patch: {
      goal: result.goal,
      criteria: result.criteria.map((c, i) => ({ id: `c${i + 1}`, ...c, status: 'open', proof: [] })),
      outOfScope: result.outOfScope,
      risk: result.risk,
      decisions: result.decisions.map((d, i) => ({ id: `d${i + 1}`, ...d })),
      plan: { steps: result.plan },
    },
    events: [{ type: 'brief.submitted', data: { runId: String(run.id) } }],
  }),
})
