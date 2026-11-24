import { z } from 'zod'
import { findingSchema, OUTLINE_MAX, resultSchema } from './record/schema'

const id = z.string().trim().min(1)

export const VERIFIED_STATUSES = ['open', 'met', 'partial', 'missing'] as const

export const verifyResultSchema = z.object({
  headSha: id,
  patchId: id,
  criteria: z
    .array(
      z.object({
        id: z.string().regex(/^c[1-9][0-9]*$/),
        status: z.enum(VERIFIED_STATUSES),
        proof: z.array(id),
      }),
    )
    .max(7),
  findings: z.array(findingSchema).max(20),
  verdict: z.enum(['pass', 'changes']),
  changes: resultSchema.shape.changes,
  walkthrough: resultSchema.shape.walkthrough,
  notVerified: resultSchema.shape.notVerified,
  outline: z.string().trim().max(OUTLINE_MAX).nullable().default(null),
})

export type VerifyResult = z.infer<typeof verifyResultSchema>
