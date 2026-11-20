import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { AdvanceDeps } from './engine'
import { fold } from './fold'
import { ProductObserving, TargetNotFound, WrongItemKind } from './forge/errors'
import { renderStatus } from './forge/status'
import type { ForgeWriter, Target } from './forge/writer'
import { foldOptions } from './lifecycle'
import type { Effect } from './module'
import { appendEvent, readEvents, readRecord, type StoredRecord } from './record/store'

export type ForgePort = Pick<ForgeWriter, 'setStageLabel' | 'upsertStatusComment' | 'postQuestion' | 'closeIssue'>

const REFUSALS = [ProductObserving, TargetNotFound, WrongItemKind]
const KINDS = { question: 'question', close: 'close', status: 'status-comment' } as const

const idRow = z.object({ id: z.coerce.number() })

const issueItem = async (payload: Payload, stored: StoredRecord): Promise<number | null> => {
  const { repo, number } = stored.record.source
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${repo} AND "number" = ${number} AND "kind" = 'issue'`)
  return found.rows[0] ? idRow.parse(found.rows[0]).id : null
}

const statusOf = async (deps: AdvanceDeps, stored: StoredRecord, target: Target, writer: ForgePort) => {
  const events = await readEvents(deps.payload, stored.id)
  const state = fold(events, foldOptions(await deps.configFor(stored.id)))
  const changed = events.findLast((event) => !event.type.startsWith('forge.write.'))
  const body = renderStatus({
    record: stored.record,
    stage: state.stage,
    pr: state.patch?.pr ?? null,
    changedAt: changed?.createdAt ?? null,
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
    case 'status':
      return statusOf(deps, stored, target, writer)
  }
}

const recordRefusal = async (deps: AdvanceDeps, stored: StoredRecord, effect: Effect, error: Error) => {
  const { repo, number } = stored.record.source
  const data = { kind: KINDS[effect.kind], target: { repo, number }, reason: error.message.trim() || error.name }
  await appendEvent(deps.payload, stored.id, { type: 'forge.write.failed', data, actor: 'factory' })
}

export const runEffects = async (deps: AdvanceDeps, recordId: number, effects: Effect[]): Promise<void> => {
  const writer = deps.forge
  if (!writer || effects.length === 0) return
  const stored = await readRecord(deps.payload, recordId)
  const item = await issueItem(deps.payload, stored)
  if (item === null) return
  const target = { recordId, itemId: item }
  for (const effect of effects) {
    try {
      await perform(deps, stored, target, effect, writer)
    } catch (error) {
      if (REFUSALS.some((refusal) => error instanceof refusal) && error instanceof Error) {
        await recordRefusal(deps, stored, effect, error)
      }
    }
  }
}
