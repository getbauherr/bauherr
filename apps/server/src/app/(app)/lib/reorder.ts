import type { Payload } from 'payload'
import { board } from '../../../core/views/board'
import { rankChanges } from '../../../core/views/reorder'
import { setRank } from '../../../core/record/store'

export const moveInStage = async (
  payload: Payload,
  input: { workspace: number; recordId: number; afterId: number | null },
): Promise<boolean> => {
  const { stages } = await board(payload, { workspace: input.workspace, now: new Date() })
  const stage = Object.values(stages).find((cards) => cards.some((card) => card.recordId === input.recordId))
  if (!stage || stage[0]?.stage === 'done') return false
  const ranked = stage.map((card) => ({ id: card.recordId, rank: card.rank }))
  const changes = rankChanges(ranked, input.recordId, input.afterId)
  if (changes === null) return false
  await payload.db.drizzle.transaction(async (tx) => {
    for (const change of changes) await setRank({ db: { drizzle: tx } }, change.id, change.rank)
  })
  return true
}
