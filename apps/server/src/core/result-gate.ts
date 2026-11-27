import type { Payload } from 'payload'
import { autoAcceptFor, recordAutoAccept } from './auto-accept'
import type { State } from './lifecycle'
import { unfinishedParts } from './relations/parts'
import type { StoredRecord } from './record/store'

export type ResultGate = { kind: 'raise' } | { kind: 'accepted' } | { kind: 'parts'; reason: string }

export const gateResult = async (
  deps: { payload: Payload; now: Date },
  stored: StoredRecord,
  state: State,
): Promise<ResultGate> => {
  const open = await unfinishedParts(deps.payload, stored.id)
  if (open.length > 0) return { kind: 'parts', reason: `Waiting for parts ${open.map((n) => `#${n}`).join(', ')}` }
  const auto = await autoAcceptFor(deps, stored, state)
  if (auto === null) return { kind: 'raise' }
  await recordAutoAccept(deps.payload, stored.id, auto)
  return { kind: 'accepted' }
}
