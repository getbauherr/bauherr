import type { TaskConfig } from 'payload'
import { createReleaser } from './run'

export const advanceReleasesTask = (
  schedule: NonNullable<TaskConfig['schedule']>,
): TaskConfig<{ input: Record<string, never>; output: { advanced: number } }> => ({
  slug: 'advance-releases',
  schedule,
  retries: 0,
  concurrency: () => 'advance-releases',
  handler: async ({ req }) => ({ output: { advanced: await createReleaser(req.payload).advanceRunning() } }),
})
