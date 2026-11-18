import { sql } from '@payloadcms/db-postgres'
import type { Forge } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { wipLimit } from './wip-limits'
import { workflowFor } from './factory'
import { defaultWip, nameOf } from './workflow'

type Doc = Record<string, any>

export const MERGE_MODES = ['direct', 'queue', 'train'] as const
export type MergeMode = (typeof MERGE_MODES)[number]

export const mergeModeOf = (product: Doc): MergeMode => (MERGE_MODES as readonly string[]).includes(product.mergeMode) ? product.mergeMode : 'direct'

export const TRAIN_BRANCH = 'bauherr/train'

export const isQueue = (product: Doc): boolean => mergeModeOf(product) === 'queue'

export const isTrain = (product: Doc): boolean => mergeModeOf(product) === 'train'

export const trainConcurrency = (workspace: { id?: number | string; wipLimits?: unknown } | null | undefined): number => {
  const wf = workflowFor(workspace as { id: number } | null | undefined)
  const review = nameOf(wf, 'review')
  return wipLimit(workspace, review) ?? defaultWip(wf)[review]!
}

export const dequeueBeforeChange = async (payload: Payload, t: Doc, mr: { backend: { forge: Forge }; repo: string; pr: { number: number } }): Promise<void> => {
  await mr.backend.forge.dequeuePullRequest(mr.repo, mr.pr.number)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = 'waiting_checks', "review_waiting_since" = now(), "queued_at" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "review_state" = 'queued'`)
}
