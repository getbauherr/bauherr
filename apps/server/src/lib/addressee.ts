import type { Where } from 'payload'
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

/** The Tickets a Product owner's Inbox and badge list (database only): those whose need asks them, and those whose open questions have rows that name them although the checkpoint asks the Bauherr (`tickets.openOwnerRows`). */
export const asksOwner: Where = { or: [{ needsBy: { equals: 'product-owner' } }, { and: [{ openOwnerRows: { greater_than: 0 } }, { needsYou: { in: ['Answer questions', 'Answer decisions'] } }] }] }

/** `asksOwner` for a loaded Ticket row. */
export const asksOwnerRow = (t: { needsBy?: string | null; needsYou?: string | null; openOwnerRows?: number | null }): boolean =>
  t.needsBy === 'product-owner' || ((t.openOwnerRows ?? 0) > 0 && (t.needsYou === 'Answer questions' || t.needsYou === 'Answer decisions'))
