import { readRecord } from '../../src/core/record/store'
import type { Engine } from './harness'

export const QUESTION = 'Which storage should the export use?'

export const referral = async (e: Engine, id: number): Promise<string> =>
  `${QUESTION} See #${(await readRecord(e.db.payload, id)).record.source.number} and #9999.`
