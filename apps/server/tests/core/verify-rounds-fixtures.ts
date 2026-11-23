import type { Finding } from '../../src/core/record/schema'

export const OPEN_FINDING: Finding = {
  id: 'f1',
  axis: 'spec',
  text: 'A failed chunk is never retried, so a 200 MB export can stop halfway.',
  evidence: { kind: 'test', pointer: 'export.test.ts: retry' },
  status: 'open',
}

const SENTENCE = 'I kept the chunked export and did not add the retry the verifier asks for. '

export const LONG_HANDOFF = `${SENTENCE.repeat(15)}END`
