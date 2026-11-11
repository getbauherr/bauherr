import type { Payload } from 'payload'
import { matches } from './glob'
import { ticketPaths } from './overlap'
import { id } from './release'
import { skipTarget, type StageDef, type Workflow } from './workflow-rules'
import { evalWhen, type Facts } from './workflow-when'
import { stage as stageDef } from './workflow'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export type Skipped = { stage: StageDef; reason: string }

/**
 * What a condition is judged by: the Product's path sets, the Ticket's labels and the changed paths (the MR's files once there is an MR, else the plan's Files section; none found = not known, which matches).
 */
export const factsOf = async (payload: Payload, t: Doc): Promise<Facts> => {
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), select: { pathSets: true }, ...o })) as Doc
  const paths = await ticketPaths(payload, t, [])
  return { paths: paths.length ? paths : null, labels: (t.labels as string[] | undefined) ?? [], sets: (product.pathSets as Record<string, string[]> | null) ?? {} }
}

/**
 * The one place that decides "enter or skip": from the stage `to` a Ticket is about to enter, follows the skip path of every conditional stage whose `when` does not match
 * until a stage that matches or has no condition. Returns the stage to enter and the stages skipped on the way (with the reason in plain words). Never skips into a cycle.
 */
export const routeEntry = async (payload: Payload, t: Doc, wf: Workflow, to: string): Promise<{ to: string; skipped: Skipped[] }> => {
  const skipped: Skipped[] = []
  let facts: Facts | undefined
  for (let def = stageDef(wf, to); def?.when && !skipped.some((s) => s.stage === def); ) {
    const v = evalWhen(def.when, (facts ??= await factsOf(payload, t)), matches)
    const next = skipTarget(def)
    if (v.match || !next) break
    skipped.push({ stage: def, reason: v.reason })
    to = next
    def = stageDef(wf, to)
  }
  return { to, skipped }
}
