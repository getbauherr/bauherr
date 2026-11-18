import type { Need } from './needs-you'
import type { Kind } from './workflow'

export const SKILL_NEED = 'Approve skill proposal'

export const WAITING_FOR_YOU = 'Waiting for you'

export const GRAPH_CHECKPOINT = { refine: 'Answer questions', plan: 'Approve plan', staging: 'Accept on staging', production: 'Approve production' } as const

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

export const checkpointOfNeed = (need: Need | typeof SKILL_NEED): string => {
  if (need === SKILL_NEED) return 'Skill proposal'
  const n = NEED_NODE[need]
  if (n) return TITLE[`${n[0]}:${n[1]}`]!
  if (need === 'Decision needed') return 'Decision'
  return need === 'Expedite?' ? 'Triage' : need === 'Round cap reached' || need === 'Needs you' || need === 'Owner review' ? 'Review' : 'Stuck'
}
