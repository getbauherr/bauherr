import { z } from 'zod'
import { heartbeat as extend } from '../leases'
import { defineTool, leaseToken, ownRun, runId } from './tool'

export const heartbeat = defineTool({
  name: 'heartbeat',
  description: 'Extends the lease of your run and optionally records a progress step. Returns the new lease expiry.',
  access: 'agent',
  input: z.strictObject({ runId, leaseToken, step: z.string().trim().min(1).max(500).optional() }),
  run: async (input, context) => {
    await ownRun(context, input.runId)
    const { now } = context.deps
    const options = input.step === undefined ? { now } : { now, step: input.step }
    const run = await extend(context.deps.payload, input.runId, input.leaseToken, options)
    return { leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null }
  },
})
