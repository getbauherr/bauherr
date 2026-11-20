import type { Payload, TaskConfig } from 'payload'
import { defaultDeps, syncSources, type SyncDeps, type SyncResult } from './mirror/sync'

export const mirrorSyncTask = (
  schedule: NonNullable<TaskConfig['schedule']>,
  afterStored?: (payload: Payload) => NonNullable<SyncDeps['afterStored']>,
): TaskConfig<{ input: Record<string, never>; output: SyncResult }> => ({
  slug: 'sync-mirror',
  schedule,
  retries: 0,
  concurrency: () => 'sync-mirror',
  handler: async ({ req }) => {
    const hook = afterStored?.(req.payload)
    const deps = defaultDeps(req.payload)
    return { output: await syncSources(req.payload, hook ? { ...deps, afterStored: hook } : deps) }
  },
})
