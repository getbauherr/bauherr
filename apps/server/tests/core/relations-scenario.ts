import { readRecord } from '../../src/core/record/store'
import type { TicketRecord } from '../../src/core/record/schema'
import type { Engine } from './harness'

const ONE_WAY: NonNullable<TicketRecord['risk']> = {
  door: 'one-way',
  areas: ['export'],
  rollback: 'Restore a backup.',
}

export const proposedRelations = async (
  e: Engine,
  fields: Partial<TicketRecord>,
  blocker: number,
  parent: number,
): Promise<Partial<TicketRecord>> => {
  const number = async (id: number) => (await readRecord(e.db.payload, id)).record.source.number
  return {
    ...fields,
    risk: ONE_WAY,
    relations: [
      { type: 'blocked-by', ticket: await number(blocker), reason: 'The export needs its storage first.' },
      { type: 'part-of', ticket: await number(parent), reason: 'It is one step of the export rework.' },
    ],
  }
}
