import type { TaskConfig } from 'payload'
import { defaultDeps, syncSources, type SyncResult } from './mirror/sync'

export const mirrorSyncTask = (
  schedule: NonNullable<TaskConfig['schedule']>,
): TaskConfig<{ input: Record<string, never>; output: SyncResult }> => ({
  slug: 'sync-mirror',
  schedule,
  retries: 0,
  concurrency: () => 'sync-mirror',
  handler: async ({ req }) => ({ output: await syncSources(req.payload, defaultDeps(req.payload)) }),
})
