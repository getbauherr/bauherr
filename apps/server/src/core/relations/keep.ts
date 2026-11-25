import type { AdvanceDeps } from '../engine'
import { ProductObserving, TargetNotFound, WrongItemKind } from '../forge/errors'
import { appendEvent, readRecord } from '../record/store'
import type { ProposedRelation } from '../record/schema'
import { edgeOf } from './proposal'
import { itemsByNumber } from './store'
import { RelationRefused } from './types'

const REFUSALS = [RelationRefused, ProductObserving, TargetNotFound, WrongItemKind]

export const createKept = async (deps: AdvanceDeps, recordId: number, relations: ProposedRelation[]): Promise<void> => {
  const writer = deps.forge
  if (!writer || relations.length === 0) return
  const stored = await readRecord(deps.payload, recordId)
  const { repo, number } = stored.record.source
  const ids = await itemsByNumber(deps.payload, stored.workspace, repo, [number, ...relations.map((r) => r.ticket)])
  const self = ids.get(number)
  for (const relation of relations) {
    const other = ids.get(relation.ticket)
    try {
      if (self === undefined || other === undefined) {
        throw new TargetNotFound(`#${relation.ticket} and #${number} must both be mirrored: sync the repository first.`)
      }
      await writer.addRelation(recordId, edgeOf(relation.type, self, other))
    } catch (error) {
      if (!REFUSALS.some((refusal) => error instanceof refusal) || !(error instanceof Error)) continue
      const reason = error.message.trim() || error.name
      const data = { kind: 'relation-add' as const, target: { repo, number }, reason }
      await appendEvent(deps.payload, recordId, { type: 'forge.write.failed', data, actor: 'factory' })
    }
  }
}
