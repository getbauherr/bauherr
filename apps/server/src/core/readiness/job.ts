import type { TaskConfig } from 'payload'
import { defaultDeps } from '../mirror/sync'
import { refreshReadiness } from './refresh'

export const readinessTask = (
  schedule: NonNullable<TaskConfig['schedule']>,
): TaskConfig<{ input: Record<string, never>; output: { checked: number; failed: number } }> => ({
  slug: 'check-readiness',
  schedule,
  retries: 0,
  concurrency: () => 'check-readiness',
  handler: async ({ req }) => {
    const result = await refreshReadiness(req.payload, defaultDeps(req.payload), null)
    return { output: { checked: result.checked, failed: result.errors.length } }
  },
})
