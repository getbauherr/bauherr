import type { Payload, TaskConfig } from 'payload'
import { z } from 'zod'
import { MIRROR_ITEM, type MirrorItemInput } from './hooks/queue'
import { refreshItem } from './mirror/item'
import { liveSource } from './mirror/store'
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

const mirrorItemInput = z.object({ source: z.number(), kind: z.enum(['issue', 'pr']), number: z.number() })

export const mirrorItemTask = (
  afterStored?: (payload: Payload) => NonNullable<SyncDeps['afterStored']>,
  depsFor: (payload: Payload) => SyncDeps = defaultDeps,
): TaskConfig<{ input: MirrorItemInput; output: { stored: number } }> => ({
  slug: MIRROR_ITEM,
  retries: 0,
  concurrency: {
    key: ({ input }) => `${MIRROR_ITEM}:${input.source}:${input.kind}:${input.number}`,
    supersedes: true,
  },
  handler: async ({ input, req }) => {
    const { payload } = req
    const wanted = mirrorItemInput.parse(input)
    const source = await liveSource(payload, wanted.source)
    if (!source) return { output: { stored: 0 } }
    const deps = depsFor(payload)
    const stored = await refreshItem(payload, source, await deps.reader(source), wanted, deps.now())
    await afterStored?.(payload)(source, stored)
    return { output: { stored: stored.length } }
  },
})
