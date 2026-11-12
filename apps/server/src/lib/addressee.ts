import { checkpointBy, type CheckpointOf, type Workflow } from './workflow'
import type { Addressee } from './workflow-rules'

/** The checkpoint a Ticket need belongs to; every other need (a stuck Run, a failed deploy check, production checks to configure, the review) is the Bauherr's. */
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

/** Who the workflow asks for a need (`stage` is the Ticket's stage, for a `human` stage). Not yet the fallback to the Bauherr when the Product has no Product owner: see `askedOf`. */
export const needBy = (wf: Workflow, need: string, stage?: string | null): Addressee => {
  const key = CHECKPOINT_OF[need]
  return key ? checkpointBy(wf, key, stage ?? undefined) : 'bauherr'
}

/** Who is asked in fact: a checkpoint addressed to the Product owner of a Product without one is the Bauherr's. */
export const askedOf = (by: Addressee, ownerAssigned: boolean): Addressee => (by === 'product-owner' && !ownerAssigned ? 'bauherr' : by)
