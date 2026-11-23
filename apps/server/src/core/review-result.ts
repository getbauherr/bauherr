import { z } from 'zod'
import { findingSchema } from './record/schema'

const id = z.string().trim().min(1)

export const reviewResultSchema = z.object({
  headSha: id,
  patchId: id,
  findings: z.array(findingSchema).max(20),
})

export type ReviewResult = z.infer<typeof reviewResultSchema>
