import type { Payload } from 'payload'
import { loadRows } from '../../../core/views/rows'
import { rankChanges } from '../../../core/views/reorder'
import { setRank } from '../../../core/record/store'

export const moveInStage = async (
  payload: Payload,
  input: { workspace: number; recordId: number; afterId: number | null },
): Promise<boolean> => {
  const rows = await loadRows(payload, { workspace: input.workspace, now: new Date() })
  const stage = rows.find((row) => row.recordId === input.recordId)?.stage
  if (!stage || stage === 'done') return false
  const ranked = rows
    .filter((row) => row.stage === stage && row.parked === null)
    .map((row) => ({ id: row.recordId, rank: row.rank }))
  const changes = rankChanges(ranked, input.recordId, input.afterId)
  if (changes === null) return false
  await payload.db.drizzle.transaction(async (tx) => {
    for (const change of changes) await setRank({ db: { drizzle: tx } }, change.id, change.rank)
  })
  return true
}
