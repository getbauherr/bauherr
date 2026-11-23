import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { AdvanceDeps } from './engine'
import type { Deferred } from './events'
import { fold, type State } from './fold'
import { ProductObserving, TargetNotFound, WrongItemKind } from './forge/errors'
import { renderStatus } from './forge/status'
import type { ForgeWriter, Target } from './forge/writer'
import { foldOptions } from './lifecycle'
import type { Effect } from './module'
import { appendEvent, readEvents, readRecord, type StoredRecord } from './record/store'

export type ForgePort = Pick<
  ForgeWriter,
  'setStageLabel' | 'upsertStatusComment' | 'postQuestion' | 'closeIssue' | 'reopenIssue' | 'reviewPullRequest'
>

const REFUSALS = [ProductObserving, TargetNotFound, WrongItemKind]
const KINDS = {
  question: 'question',
  close: 'close',
  reopen: 'reopen',
  status: 'status-comment',
  review: 'review',
} as const

const idRow = z.object({ id: z.coerce.number() })

const mirrorItem = async (
  payload: Payload,
  stored: StoredRecord,
  kind: 'issue' | 'pr',
  number: number,
): Promise<number | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${stored.record.source.repo}
      AND "number" = ${number} AND "kind" = ${kind}`)
  return found.rows[0] ? idRow.parse(found.rows[0]).id : null
}

const itemOf = (payload: Payload, stored: StoredRecord, effect: Effect): Promise<number | null> =>
  effect.kind === 'review'
    ? mirrorItem(payload, stored, 'pr', effect.pr)
    : mirrorItem(payload, stored, 'issue', stored.record.source.number)

const waitingOnConflict = (state: State): string | null =>
  state.adopted && state.conflict !== null && state.conflict.patchId === state.patch?.id ? state.conflict.base : null

const statusOf = async (deps: AdvanceDeps, stored: StoredRecord, target: Target, writer: ForgePort) => {
  const events = await readEvents(deps.payload, stored.id)
  const state = fold(events, foldOptions(await deps.configFor(stored.id)))
  const changed = events.findLast((event) => !event.type.startsWith('forge.write.'))
  const body = renderStatus({
    record: stored.record,
    stage: state.stage,
    pr: state.patch?.pr ?? null,
    changedAt: changed?.createdAt ?? null,
    conflict: waitingOnConflict(state),
  })
  await writer.setStageLabel(target, state.stage)
  await writer.upsertStatusComment(target, body)
}

const perform = async (deps: AdvanceDeps, stored: StoredRecord, target: Target, effect: Effect, writer: ForgePort) => {
  switch (effect.kind) {
    case 'question':
      return writer.postQuestion(target, effect.body)
    case 'close':
      return writer.closeIssue(target, effect.reason)
    case 'reopen':
      return writer.reopenIssue(target)
    case 'status':
      return statusOf(deps, stored, target, writer)
    case 'review':
      return writer.reviewPullRequest(target, effect.body)
  }
}

const deferral = (effect: Effect, target: Deferred['target']): Deferred | null => {
  switch (effect.kind) {
    case 'question':
      return { kind: 'question', target, body: effect.body }
    case 'close':
      return { kind: 'close', target, reason: effect.reason }
    case 'review':
      return { kind: 'review', target: { ...target, number: effect.pr }, body: effect.body }
    case 'status':
    case 'reopen':
      return null
  }
}

const recordRefusal = async (deps: AdvanceDeps, stored: StoredRecord, effect: Effect, error: Error) => {
  const { repo, number } = stored.record.source
  const target = { repo, number: effect.kind === 'review' ? effect.pr : number }
  const deferred = error instanceof ProductObserving ? deferral(effect, target) : null
  if (deferred !== null) {
    await appendEvent(deps.payload, stored.id, { type: 'forge.write.deferred', data: deferred, actor: 'factory' })
    return
  }
  const data = { kind: KINDS[effect.kind], target, reason: error.message.trim() || error.name }
  await appendEvent(deps.payload, stored.id, { type: 'forge.write.failed', data, actor: 'factory' })
}

export const runEffects = async (deps: AdvanceDeps, recordId: number, effects: Effect[]): Promise<void> => {
  const writer = deps.forge
  if (!writer || effects.length === 0) return
  const stored = await readRecord(deps.payload, recordId)
  for (const effect of effects) {
    const itemId = await itemOf(deps.payload, stored, effect)
    if (itemId === null) continue
    const target = { recordId, itemId }
    try {
      await perform(deps, stored, target, effect, writer)
    } catch (error) {
      if (REFUSALS.some((refusal) => error instanceof refusal) && error instanceof Error) {
        await recordRefusal(deps, stored, effect, error)
      }
    }
  }
}
