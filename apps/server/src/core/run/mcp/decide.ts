import { z } from 'zod'
import { decide as decideRecord, NOTE_MAX } from '../../decide'
import { defineTool } from './tool'

export const decide = defineTool({
  name: 'decide',
  description:
    'Records the owner decision on the card a ticket currently shows. ' +
    'Returns once the decision is applied; a stale card is refused.',
  access: 'person',
  input: z.strictObject({
    record: z.number().int().positive(),
    ask: z.string().min(1).max(100),
    choice: z.string().min(1).max(100),
    seq: z.number().int().min(0),
    note: z
      .string()
      .max(NOTE_MAX * 2)
      .optional(),
  }),
  run: async ({ record, ask, choice, seq, note }, { deps, person }) => {
    const decision = { ask, choice, seq, ...(note === undefined ? {} : { note }) }
    await decideRecord(record, person, decision, deps)
    return { status: 'decided' as const }
  },
})
