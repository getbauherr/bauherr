import { sql } from '@payloadcms/db-postgres'
import type { Forge } from '@bauherr/adapters'
import type { Payload } from 'payload'

type Doc = Record<string, any>

export const MERGE_MODES = ['direct', 'queue', 'train'] as const
export type MergeMode = (typeof MERGE_MODES)[number]

export const mergeModeOf = (product: Doc): MergeMode => (MERGE_MODES as readonly string[]).includes(product.mergeMode) ? product.mergeMode : 'direct'

/** The merge gate hands the reviewed head to the forge's native queue. Everything else (`direct`, and `train` until the factory train exists) is merged by the factory itself, and a PR behind its base gets the base merged in first (#276). */
export const isQueue = (product: Doc): boolean => mergeModeOf(product) === 'queue'

/**
 * A queued entry must never be pushed to (a push invalidates it on both forges): takes the PR out of the queue and moves a `queued` Ticket back to `waiting_checks`.
 * Idempotent; the caller decides what happens to the Ticket next.
 */
export const dequeueBeforeChange = async (payload: Payload, t: Doc, mr: { backend: { forge: Forge }; repo: string; pr: { number: number } }): Promise<void> => {
  await mr.backend.forge.dequeuePullRequest(mr.repo, mr.pr.number)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = 'waiting_checks', "review_waiting_since" = now(), "queued_at" = NULL, "updated_at" = now() WHERE "id" = ${t.id} AND "review_state" = 'queued'`)
}
