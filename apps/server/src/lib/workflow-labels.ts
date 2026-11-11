import type { Kind } from './workflow-rules'

// Browser-safe plain-word texts of the workflow editor (and the change list of History and Review).

type Doc = Record<string, any>

export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
export const humanize = (key: string): string => capitalize(key.replace(/[_-]+/g, ' '))
/** The title a stage shows: its `title`, else its name capitalised (the file may carry none). */
export const stageTitle = (s: Doc): string => (typeof s.title === 'string' && s.title ? s.title : capitalize(String(s.name)))

export const STEP_TEXT: Record<Kind, string> = {
  triage: 'Sorts new tickets and collects open questions',
  plan: 'Writes the plan',
  build: 'Writes the code and opens the merge request',
  review: 'Checks the change against the plan',
  release: 'Merges, deploys to staging, then to production',
  container: 'Holds a ticket that was split into sub-tickets',
  done: 'Finished tickets end here',
  agent: 'An extra step worked by an agent',
  human: 'Waits for your decision',
}

/** What each built-in path means, as the start of "when ...". */
export const PATH_LABEL: Partial<Record<Kind, Record<string, string>>> = {
  triage: { plan: 'Ready to plan', refine: 'Needs your answers', skip: 'Not for the factory' },
  plan: { done: 'Plan is ready', decisions: 'Needs your decisions', split: 'Ticket is split into sub-tickets' },
  container: { children_done: 'All sub-tickets are done' },
  build: { done: 'Code is ready', stuck: 'Stuck, needs help', replan: 'Plan does not hold' },
  review: { clean: 'Nothing to fix', changes: 'Changes needed', stop: 'Stop this ticket' },
  release: { accepted: 'Accepted', changes: 'Changes needed' },
}
export const pathLabel = (kind: Kind, key: string): string => PATH_LABEL[kind]?.[key] ?? humanize(key)

export const SPECIAL_TARGET: Record<string, string> = { escalate: 'Hand to the orchestrator', backlog: 'Back to the backlog' }

export type CheckpointKey = 'refine' | 'plan' | 'staging' | 'production'
/** One word set per checkpoint: the chip in the header strip, the row in the flow, the muted row when it is switched off. */
export const CHECKPOINT: Record<CheckpointKey, { chip: string; row: string; off: string }> = {
  refine: { chip: 'Open questions', row: 'You answer open questions', off: 'Not asked: open questions' },
  plan: { chip: 'Approve the plan', row: 'You approve the plan', off: 'Not asked: approve the plan' },
  staging: { chip: 'Accept on staging', row: 'You accept the result on staging', off: 'Not asked: accept the result on staging' },
  production: { chip: 'Approve production', row: 'You approve production', off: 'Not asked: approve production' },
}

/** The plain words of a rule finding: the editor says step and path, not stage and outcome. */
export const plainFinding = (f: string): string => f.replace(/\bstages\b/g, 'steps').replace(/\bstage\b/g, 'step').replace(/\boutcomes\b/g, 'paths').replace(/\boutcome\b/g, 'path')

export const modelText = (r: Doc): string => (r.tier ? `${capitalize(String(r.tier))} tier` : r.model ? String(r.model) : 'No model')

/** The finding of an apply whose base version is no longer the active one. */
export const STALE = 'the workflow changed since you loaded it'
