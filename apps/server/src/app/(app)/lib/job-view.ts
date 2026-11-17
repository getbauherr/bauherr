import { humanize } from '../../../lib/workflow-labels'
import { jobsOf, type Addressee, type StageDef } from '../../../lib/workflow-rules'
import type { Workflow } from '../../../lib/workflow'
import type { When } from '../../../lib/workflow-when'
import type { TicketRow } from './overview'
import { checkpointOf } from './workflow-view'

export type ViewJob = { id: string; title: string; kind: 'agent' | 'human'; role?: string; skill?: string; by?: Addressee; needs: string[]; when?: When; blocking: boolean; depth: number }
export type LiveRun = { ticket: number; stage: string; job: string | null }
export type JobChip = { id: string; title: string; count: number }

export const hasJobs = (def: StageDef): boolean => !!def.jobs?.length

/** The Jobs of a stage in order, with their depth in the `needs` graph; a plan stage with an approval gate gets its human `approve` Job last (the gate is compiled out of `jobs`). */
export const stageJobs = (def: StageDef): ViewJob[] => {
  const list = jobsOf(def).map((j) => ({ id: j.id, title: j.id === def.name ? def.title : humanize(j.id), kind: j.kind, role: j.role, skill: j.skill, by: j.by, needs: j.needs, when: j.when, blocking: j.blocking }))
  if (def.kind === 'plan' && def.jobs && def.gate === 'human') list.push({ id: 'approve', title: 'Approve', kind: 'human', role: undefined, skill: undefined, by: def.gate_by ?? 'bauherr', needs: list.map((j) => j.id), when: undefined, blocking: true })
  const depth = new Map<string, number>()
  return list.map((j) => {
    const d = j.needs.length ? 1 + Math.max(...j.needs.map((n) => depth.get(n) ?? 0)) : 0
    depth.set(j.id, d)
    return { ...j, depth: d }
  })
}

/** Per stage with explicit Jobs, per Job: the open Tickets waiting in or working on it; a live Run of a Job counts its Ticket, the human Job counts the Tickets waiting at the stage's approval. `only` limits the result to one stage (also a stage without explicit Jobs). */
export const jobTickets = (wf: Workflow, rows: Pick<TicketRow, 'id' | 'stage' | 'open' | 'parked' | 'needsYou'>[], live: LiveRun[], only?: string): Map<string, Map<string, number[]>> => {
  const out = new Map<string, Map<string, number[]>>()
  for (const def of wf.stages) {
    if (only ? def.name !== only : !hasJobs(def)) continue
    const here = rows.filter((t) => t.open && !t.parked && t.stage === def.name)
    const ids = new Set(here.map((t) => t.id))
    const own = jobsOf(def)[0]!.id
    const gate = here.filter((t) => checkpointOf(wf, t) === `${def.name}:gate`).map((t) => t.id)
    out.set(def.name, new Map(stageJobs(def).map((j) => [j.id, j.kind === 'human' ? gate : [...new Set(live.filter((r) => r.stage === def.name && (r.job ?? own) === j.id && ids.has(r.ticket)).map((r) => r.ticket))]])))
  }
  return out
}

export const chipsOf = (wf: Workflow, counts: Map<string, Map<string, number[]>>): Map<string, JobChip[]> =>
  new Map(wf.stages.filter((s) => counts.has(s.name) && hasJobs(s)).map((s) => [s.name, stageJobs(s).map((j) => ({ id: j.id, title: j.title, count: counts.get(s.name)!.get(j.id)!.length }))]))

export const BOX = { w: 232, h: 272, gap: 56, row: 16, lane: 8 }
export type JobLayout = { width: number; height: number; nodes: Map<string, { x: number; y: number }>; edges: { key: string; d: string; skip: boolean }[] }

/** Columns by dependency depth, one row per Job of a column in order; a `needs` edge runs from the right side of the needed Job to the left side of the Job, a skip over a column along a lane above all cards. Coordinates are pixels (fixed card size, so it renders on the server). */
export const layoutJobs = (jobs: ViewJob[]): JobLayout => {
  const rows = new Map<number, number>()
  const nodes = new Map<string, { x: number; y: number }>()
  const skips = jobs.flatMap((j) => j.needs.filter((n) => j.depth - jobs.find((x) => x.id === n)!.depth > 1).map((n) => `${n}>${j.id}`))
  const top = skips.length ? skips.length * BOX.lane + BOX.lane : 2
  for (const j of jobs) {
    const row = rows.get(j.depth) ?? 0
    rows.set(j.depth, row + 1)
    nodes.set(j.id, { x: 2 + j.depth * (BOX.w + BOX.gap), y: top + row * (BOX.h + BOX.row) })
  }
  const edges = jobs.flatMap((j) =>
    j.needs.map((n) => {
      const a = nodes.get(n)!
      const b = nodes.get(j.id)!
      const [x1, y1, x2, y2] = [a.x + BOX.w, a.y + BOX.h / 2, b.x, b.y + BOX.h / 2]
      const skip = j.depth - jobs.find((x) => x.id === n)!.depth > 1
      const lane = BOX.lane * (skips.length - skips.indexOf(`${n}>${j.id}`))
      return { key: `${n}>${j.id}`, skip, d: skip ? `M${x1} ${y1}H${x1 + BOX.gap / 2}V${lane}H${x2 - BOX.gap / 2}V${y2}H${x2}` : `M${x1} ${y1}H${x1 + BOX.gap / 2}V${y2}H${x2}` }
    }),
  )
  const depth = Math.max(...jobs.map((j) => j.depth)) + 1
  return { width: depth * BOX.w + (depth - 1) * BOX.gap + 4, height: top + Math.max(...rows.values()) * (BOX.h + BOX.row) - BOX.row + 2, nodes, edges }
}
