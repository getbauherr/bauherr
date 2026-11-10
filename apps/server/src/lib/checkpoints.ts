import type { Need } from './needs-you'
import type { Kind } from './workflow'

/** The status label of a Ticket that waits for a person (`ticketStatus`), also on the Inbox cards. */
export const WAITING_FOR_YOU = 'Waiting for you'

/** The titles of the Workflow graph's checkpoint nodes (`graph()` in workflow.ts): the checkpoint names of the whole UI. */
export const GRAPH_CHECKPOINT = { refine: 'Answer questions', plan: 'Approve plan', staging: 'Accept on staging', production: 'Approve production' } as const

/** The graph node (stage kind, node suffix) a need waits at; needs that are no checkpoint node are not listed. */
export const NEED_NODE: Partial<Record<Need, [Kind, string]>> = {
  'Answer questions': ['triage', 'refine'],
  'Approve plan': ['plan', 'gate'],
  'Answer decisions': ['plan', 'gate'],
  'Accept on staging': ['release', 'gate'],
  'Staging not confirmed': ['release', 'gate'],
  'Approve production': ['release', 'production'],
  'Production deploy failed': ['release', 'production'],
  'Configure production checks': ['release', 'production'],
}

const TITLE: Record<string, string> = { 'triage:refine': GRAPH_CHECKPOINT.refine, 'plan:gate': GRAPH_CHECKPOINT.plan, 'release:gate': GRAPH_CHECKPOINT.staging, 'release:production': GRAPH_CHECKPOINT.production }

/** The checkpoint name of a need: the graph node's title, else the group it belongs to. */
export const checkpointOfNeed = (need: Need): string => {
  const n = NEED_NODE[need]
  if (n) return TITLE[`${n[0]}:${n[1]}`]!
  return need === 'Expedite?' ? 'Triage' : need === 'Round cap reached' || need === 'Needs you' ? 'Review' : 'Stuck'
}
