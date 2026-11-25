import { z } from 'zod'
import { stageSchema } from '../events'
import { DOCUMENT_SCOPES } from '../memory'
import type { Role } from '../lifecycle'

export const RUN_STATUSES = ['queued', 'claimed', 'submitted', 'failed', 'released', 'expired'] as const
export const ROLES = ['builder', 'reviewer', 'verifier'] as const satisfies Role[]
export const MAX_STEPS = 50
export const MAX_CAPACITY = 4
export const TIERS = ['cheap', 'standard', 'strong'] as const
export type Tier = (typeof TIERS)[number]
export const DEFAULT_TIER: Tier = 'standard'

export const contextSchema = z.object({
  similar: z.array(z.number().int()),
  memory: z.array(z.object({ scope: z.enum(DOCUMENT_SCOPES), text: z.string() })).optional(),
  agentsFile: z.object({ given: z.boolean(), cut: z.boolean() }),
})

export type StoredContext = z.infer<typeof contextSchema>
export type RunStatus = (typeof RUN_STATUSES)[number]
export type RunStep = { at: string; text: string }

export const runRowSchema = z.object({
  id: z.coerce.number(),
  record_id: z.coerce.number(),
  stage: stageSchema,
  role: z.enum(ROLES),
  status: z.enum(RUN_STATUSES),
  fingerprint: z.string(),
  attempt: z.coerce.number().pipe(z.union([z.literal(0), z.literal(1)])),
  leased_by: z.string().nullable(),
  lease_expires_at: z.coerce.date().nullable(),
  steps: z.array(z.object({ at: z.string(), text: z.string() })),
  result: z.unknown(),
  error: z.string().nullable(),
  cost_usd: z.coerce.number().nullable(),
  context: contextSchema.nullable(),
})

export type Run = {
  id: number
  recordId: number
  stage: z.infer<typeof stageSchema>
  role: Role
  status: RunStatus
  fingerprint: string
  attempt: 0 | 1
  leasedBy: string | null
  leaseExpiresAt: Date | null
  steps: RunStep[]
  result: unknown
  error: string | null
  costUsd: number | null
  context: StoredContext | null
}

export const toRun = (row: unknown): Run => {
  const parsed = runRowSchema.parse(row)
  return {
    id: parsed.id,
    recordId: parsed.record_id,
    stage: parsed.stage,
    role: parsed.role,
    status: parsed.status,
    fingerprint: parsed.fingerprint,
    attempt: parsed.attempt,
    leasedBy: parsed.leased_by,
    leaseExpiresAt: parsed.lease_expires_at,
    steps: parsed.steps,
    result: parsed.result,
    error: parsed.error,
    costUsd: parsed.cost_usd,
    context: parsed.context,
  }
}
