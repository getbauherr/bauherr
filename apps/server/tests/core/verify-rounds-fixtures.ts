import type { Finding, TicketRecord } from '../../src/core/record/schema'
import type { Engine } from './harness'
import { edit, patch, toBrief, workOn } from './scenario'

export const OPEN_FINDING: Finding = {
  id: 'f1',
  axis: 'spec',
  text: 'A failed chunk is never retried, so a 200 MB export can stop halfway.',
  evidence: { kind: 'test', pointer: 'export.test.ts: retry' },
  status: 'open',
}

const SENTENCE = 'I kept the chunked export and did not add the retry the verifier asks for. '

export const LONG_HANDOFF = `${SENTENCE.repeat(15)}END`

export const verifyRoundsTicket = async (e: Engine, pr: number, brief: Partial<TicketRecord>): Promise<number> => {
  const id = await toBrief(e, false)
  await edit(e, id, 'brief', brief)
  for (const n of [501, pr]) {
    await patch(e, id, n)
    await workOn(e, id, 'verifier', { passed: false, patchId: `p${n}`, headSha: `h${n}` })
  }
  await edit(e, id, 'build', { handoff: LONG_HANDOFF })
  await edit(e, id, 'verify', { findings: [OPEN_FINDING] })
  return id
}
