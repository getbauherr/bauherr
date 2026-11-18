import type { Where } from 'payload'
import { checkpointBy, type CheckpointOf, type Workflow } from './workflow'
import type { Addressee } from './workflow-rules'

const CHECKPOINT_OF: Record<string, CheckpointOf> = {
  'Answer questions': 'refine',
  'Approve plan': 'plan',
  'Answer decisions': 'plan',
  'Accept on staging': 'staging',
  'Staging not confirmed': 'staging',
  'Approve production': 'production',
  'Production deploy failed': 'production',
  'Decision needed': 'human',
}

export const needBy = (wf: Workflow, need: string, stage?: string | null): Addressee => {
  const key = CHECKPOINT_OF[need]
  return key ? checkpointBy(wf, key, stage ?? undefined) : 'bauherr'
}

export const askedOf = (by: Addressee, ownerAssigned: boolean): Addressee => (by === 'product-owner' && !ownerAssigned ? 'bauherr' : by)

export const asksOwner: Where = { or: [{ needsBy: { equals: 'product-owner' } }, { and: [{ openOwnerRows: { greater_than: 0 } }, { needsYou: { in: ['Answer questions', 'Answer decisions'] } }] }] }

export const asksOwnerRow = (t: { needsBy?: string | null; needsYou?: string | null; openOwnerRows?: number | null }): boolean =>
  t.needsBy === 'product-owner' || ((t.openOwnerRows ?? 0) > 0 && (t.needsYou === 'Answer questions' || t.needsYou === 'Answer decisions'))
