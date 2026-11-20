import type { Payload, TaskConfig } from 'payload'
import { enterIssues } from '../core/intake/enter'
import { resumeParked } from '../core/intake/pacing'
import { remindReporters } from '../core/intake/timing'
import { createWriter } from '../core/forge/writer'
import { reactToItems, reactToOpenRecords } from '../core/mirror/react-run'
import type { SyncDeps } from '../core/mirror/sync'
import { engineDeps } from './engine-deps'

export const afterSync =
  (payload: Payload): NonNullable<SyncDeps['afterStored']> =>
  async (_source, itemIds) => {
    const deps = engineDeps(payload)
    await enterIssues(deps)
    await reactToItems(deps, itemIds)
  }

export const intakeSweepTask = (
  schedule: NonNullable<TaskConfig['schedule']>,
): TaskConfig<{ input: Record<string, never>; output: { entered: number } }> => ({
  slug: 'intake-sweep',
  schedule,
  retries: 0,
  concurrency: () => 'intake-sweep',
  handler: async ({ req }) => {
    const deps = engineDeps(req.payload)
    const entered = await enterIssues(deps)
    await reactToOpenRecords(deps)
    await remindReporters(deps, createWriter(req.payload))
    await resumeParked(deps, null)
    return { output: { entered: entered.length } }
  },
})
