import { workflowFor } from './factory'
import { DEFAULT, stage as stageDef, title, wipStages, type Workflow } from './workflow'

export type WipLimits = Partial<Record<string, number>>

/** Why `v` is not a WIP limit map (only the workflow's WIP columns, positive integers; a missing key means no limit), or null. */
export const wipLimitsError = (v: unknown, wf: Workflow = DEFAULT()): string | null => {
  if (v == null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return 'must be an object of column limits'
  for (const [k, n] of Object.entries(v)) {
    if (!wipStages(wf).includes(k)) return `unknown column ${k}`
    if (n != null && !(Number.isInteger(n) && (n as number) > 0)) return `${k}: a whole number of at least 1, or empty for no limit`
  }
  return null
}

/** The Workspace override (`wipLimits`, a missing key = no limit) when set, else the `wip` of the stage in its workflow. */
export const wipLimit = (ws: { id?: number | string; wipLimits?: unknown } | null | undefined, stage: string, wf: Workflow = workflowFor(ws as { id: number }| null | undefined)): number | null => {
  const own = ws?.wipLimits as WipLimits | null | undefined
  const n = own ? own[stage] : stageDef(wf, stage)?.wip
  return typeof n === 'number' && n > 0 ? n : null
}

const label = (s: string) => s[0].toUpperCase() + s.slice(1)

/** "Waiting: Build is full (2/2)", or "Waiting: overlaps #12" when the Ticket carries a reason. */
export const waitingText = (wf: Workflow, stage: string, count: number, limit: number | null, reason?: string | null): string => (stage === 'checks' ? 'Waiting for checks' : reason ? `Waiting: ${reason}` : `Waiting: ${label(title(wf, stage))} is full (${count}/${limit ?? count})`)
