import type { Conn } from '../conn'
import { patchRecord, readRecord } from './store'

export const dropCriteria = async (tx: Conn, recordId: number, ids: string[], note: string): Promise<void> => {
  const { record, version } = await readRecord(tx, recordId)
  const gone = record.criteria.filter((criterion) => ids.includes(criterion.id))
  await patchRecord(tx, recordId, {
    expectedVersion: version,
    writes: ['criteria', 'dropped'],
    patch: {
      criteria: record.criteria.filter((criterion) => !ids.includes(criterion.id)),
      dropped: [...record.dropped, ...gone.map(({ id, text }) => ({ id, text, note }))],
    },
    by: { stage: 'brief', runId: 'owner' },
  })
}
