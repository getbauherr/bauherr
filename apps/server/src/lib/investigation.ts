import type { Payload } from 'payload'
import { startRunIfNeeded } from '../jobs'
import { INVESTIGATION_MARKER, latestWith } from '../app/(app)/lib/plan'
import { ticketsOf, upsertTicket } from './actions'
import { APPROVED_PLAN } from './needs-you'
import { id } from './release'
import { moveStage } from './stage-move'
import { kindOfRun } from './stage-text'
import { workflowFor } from './factory'
import { nameOf } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** `escalation.reason` of the one strong fix round at the review round cap; the review after it runs strong too. */
export const REVIEW_CAP_REASON = 'review round cap'
export const MAX_INVESTIGATIONS = 2
export const REASON = 'failed twice: investigate'
export const DECISIONS = ['revise', 'fix-ticket', 'needs-human'] as const
export type Decision = (typeof DECISIONS)[number]
export type InvestigationInput = { cause: string; decision: Decision; fix?: { title: string; body?: string }; question?: string; model?: string }

/** Owner addition (2026-11-05): investigation Plan Runs get 60 turns and $2; the fresh Build Run after one gets double its normal caps. All run on the `strong` tier. */
export const escalatedCaps = (kind: string | undefined, base: { maxTurns: number; maxBudgetUsd: number }) => (kind === 'plan' ? { maxTurns: 60, maxBudgetUsd: 2 } : { maxTurns: base.maxTurns * 2, maxBudgetUsd: base.maxBudgetUsd * 2 })

/** Normal caps of a Run of stage kind `kind` (or `scan`, `docs`), before `escalatedCaps` doubles them. */
export const baseCaps = (kind: string | undefined) => (kind === 'build' ? { maxTurns: 200, maxBudgetUsd: 5 } : kind === 'scan' ? { maxTurns: 30, maxBudgetUsd: 2 } : kind === 'docs' ? { maxTurns: 60, maxBudgetUsd: 2 } : { maxTurns: 20, maxBudgetUsd: 0.5 })

/** Hard ceiling of one scan Run's USD budget, whatever the Product asks for. */
export const SCAN_MAX_BUDGET_USD = 10

/** Caps of a scan Run: the Product's `securityScan` overrides on top of `baseCaps('scan')`, the budget clamped to SCAN_MAX_BUDGET_USD. */
export const scanCaps = (product: { securityScan?: { maxTurns?: number | null; maxBudgetUsd?: number | null } | null } = {}) => {
  const base = baseCaps('scan')
  const { maxTurns, maxBudgetUsd } = product.securityScan ?? {}
  return { maxTurns: maxTurns || base.maxTurns, maxBudgetUsd: Math.min(maxBudgetUsd || base.maxBudgetUsd, SCAN_MAX_BUDGET_USD) }
}

const investigationRuns = async (payload: Payload, ticket: number | string): Promise<Doc[]> =>
  ((await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket } }, { kind: { equals: 'plan' } }] }, sort: 'id', pagination: false, ...o })).docs as Doc[]).filter((r) => r.investigation)

/** Whether the Run is an escalated one: it carries `escalation`, is an investigation Plan Run, or is the first Build Run started after the Ticket's latest investigation. */
export const isEscalated = async (payload: Payload, run: Doc): Promise<boolean> => {
  if (run.escalation) return true
  const kind = kindOfRun(workflowFor(run.workspace), run)
  if (kind === 'plan') return !!run.investigation
  if (kind !== 'build') return false
  const last = (await investigationRuns(payload, id(run.ticket))).filter((r) => r.id < run.id).pop()
  if (!last) return false
  const between = await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: id(run.ticket) } }, { kind: { equals: 'build' } }, { id: { greater_than: last.id } }, { id: { less_than: run.id } }] }, overrideAccess: true })
  return between.totalDocs === 0
}

/** Appends a section to the Ticket's one investigation Comment (created on first use). */
const note = async (payload: Payload, t: Doc, text: string): Promise<void> => {
  const ts = await ticketsOf(payload, id(t.product))
  const n = String(t.number)
  const existing = latestWith(await ts.listComments(n), INVESTIGATION_MARKER)
  if (existing) await ts.updateComment(n, existing.id, `${existing.body}\n\n${text}`)
  else await ts.comment(n, `${INVESTIGATION_MARKER}\n# Investigations\n\n${text}`)
}

/** Records the escalation of a Build Run escalated by an investigation once in the investigation Comment; ladder escalations are noted by `escalate`. */
export const noteEscalatedBuild = async (payload: Payload, run: Doc, caps: { maxTurns: number; maxBudgetUsd: number }): Promise<void> => {
  if (run.escalation) return
  const t = (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc
  const line = `Escalated: Build Run #${run.id} on tier strong (${caps.maxTurns} turns, $${caps.maxBudgetUsd}).`
  const ts = await ticketsOf(payload, id(t.product))
  if (latestWith(await ts.listComments(String(t.number)), INVESTIGATION_MARKER)?.body.includes(line)) return
  await note(payload, t, line)
}

const describeFailure = async (payload: Payload, r: Doc): Promise<string> => {
  const step = (await payload.find({ collection: 'steps', where: { run: { equals: r.id } }, sort: '-seq', limit: 1, ...o })).docs[0]
  const tools = step ? ((await payload.find({ collection: 'tool_calls', where: { step: { equals: step.id } }, pagination: false, ...o })).docs as Doc[]).map((c) => c.name) : []
  return `- Run #${r.id} (${r.stage}, ${r.status}): ${String(r.error ?? 'no error recorded').split('\n')[0]!.slice(0, 300)}${tools.length ? `; last step: ${tools.join(', ')}` : ''}`
}

/** Moves the Ticket to Plan and writes the failures section of the investigation Comment; each step is a no-op once done, so a retry after a forge error completes it. */
const completeInvestigation = async (payload: Payload, t: Doc, run: Doc): Promise<boolean> => {
  const ts = await ticketsOf(payload, id(t.product))
  const fresh = (await payload.findByID({ collection: 'tickets', id: t.id, ...o })) as Doc
  const plan = nameOf(workflowFor(t.workspace), 'plan')
  if (fresh.stage !== plan && fresh.stage !== run.investigation.stage) return false
  let did = false
  if (fresh.stage !== plan) {
    did = true
    await moveStage(payload, ts, fresh, plan, 'investigation')
    await payload.update({ collection: 'tickets', id: t.id, data: { stage: plan, waitingFor: null, waitingReason: REASON }, overrideAccess: true })
  }
  const line = `Investigation Run #${run.id}`
  if (latestWith(await ts.listComments(String(t.number)), INVESTIGATION_MARKER)?.body.includes(line)) return did
  const failed = (await Promise.all((run.investigation.failedRuns as number[]).map((r) => payload.findByID({ collection: 'runs', id: r, ...o })))) as Doc[]
  const nth = (await investigationRuns(payload, t.id)).findIndex((r) => r.id === run.id) + 1
  await note(payload, t, `## Investigation ${nth}: ${run.investigation.stage} failed twice\n${line} (tier strong).\n\n${(await Promise.all(failed.map((r) => describeFailure(payload, r)))).join('\n')}`)
  return true
}

/**
 * A stage failed twice: one investigation Plan Run starts (strong tier) carrying both failed Run ids, written with the create so the Run is an investigation from its first moment.
 * The Ticket leaves its WIP slot for Plan with the reason (Plan WIP does not hold it back) and the failures go into the investigation Comment; a step that failed is finished by `resumeInvestigations`.
 * Returns false when the Ticket already had `MAX_INVESTIGATIONS`.
 */
export const startInvestigation = async (payload: Payload, t: Doc, failed: Doc[]): Promise<boolean> => {
  if ((await investigationRuns(payload, t.id)).length >= MAX_INVESTIGATIONS) return false
  const { run, created } = await startRunIfNeeded(payload, t as { id: number; workspace?: unknown }, nameOf(workflowFor(t.workspace), 'plan'), { investigation: { failedRuns: failed.map((r) => r.id), stage: failed[0]!.stage } })
  if (!run.investigation) return false
  await completeInvestigation(payload, t, run)
  return created
}

/** Finishes investigations a forge error interrupted: a live investigation Run whose Ticket is not yet in Plan or whose Comment section is missing. Returns how many it finished. */
export const resumeInvestigations = async (payload: Payload): Promise<number> => {
  const live = (await payload.find({ collection: 'runs', where: { and: [{ kind: { equals: 'plan' } }, { status: { in: ['queued', 'awaiting_session', 'running'] } }] }, pagination: false, ...o })).docs as Doc[]
  let n = 0
  for (const run of live.filter((r) => r.investigation)) {
    try {
      if (await completeInvestigation(payload, (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc, run)) n++
    } catch (e) {
      payload.logger.warn({ err: e, run: run.id }, 'resuming the investigation failed')
    }
  }
  return n
}

/**
 * The investigation's outcome. `revise`: the plan approval is withdrawn and the Run posts a revised plan through the normal gate.
 * `fix-ticket`: a `type:bug` Ticket is filed and set as blocked-by; the Ticket waits for Build and the pull starts one fresh Build Run once the fix is closed.
 * `needs-human`: the question goes to the owner (the caller ends the Run `needs_human`).
 */
export const submitInvestigation = async (payload: Payload, run: Doc, a: InvestigationInput): Promise<{ fix?: { number: number; url: string } }> => {
  if (!run.investigation) throw new Error(`run ${run.id} is not an investigation Run`)
  if (!DECISIONS.includes(a.decision)) throw new Error(`decision must be ${DECISIONS.join('|')}`)
  if (typeof a.cause !== 'string' || !a.cause.trim()) throw new Error('cause required')
  if (a.decision === 'fix-ticket' && !a.fix?.title?.trim()) throw new Error('fix.title required for fix-ticket')
  if (a.decision === 'needs-human' && !a.question?.trim()) throw new Error('question required for needs-human')
  const t = (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc
  const ts = await ticketsOf(payload, id(t.product))
  const n = String(t.number)
  const cost = run.costUsd ?? run.costEstimateUsd
  const lines = [`Cause: ${a.cause.trim()}`, `Escalation: Run #${run.id} on tier strong, model ${a.model ?? run.model ?? 'unknown'}, cost ${cost == null ? 'not recorded yet' : `$${Number(cost).toFixed(2)}`}.`]
  let fixed: { number: number; url: string } | undefined
  if (a.decision === 'fix-ticket') {
    const fix = await ts.create({ title: a.fix!.title.trim(), body: `${a.fix!.body?.trim() ?? ''}\n\nFound while investigating #${n}.`.trim(), labels: ['type:bug'] })
    await ts.addBlockedBy(n, fix.id)
    const local = await upsertTicket(payload, { workspace: id(t.workspace), product: id(t.product), externalId: fix.id, number: fix.number, url: fix.url, title: fix.title, state: 'open', labels: fix.labels }, null)
    await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: nameOf(workflowFor(t.workspace), 'build'), waitingReason: `waiting for #${fix.number}`, blockedBy: [...new Set([...((t.blockedBy as (number | string)[]) ?? []).map(id), local.id])] }, overrideAccess: true })
    fixed = { number: fix.number, url: fix.url }
    lines.push(`Decision: fix first. Filed ${fix.url} (#${fix.number}) as blocked-by; Build starts again once it is closed.`)
  } else if (a.decision === 'revise') {
    await ts.removeLabels(n, [APPROVED_PLAN])
    await payload.update({ collection: 'tickets', id: t.id, data: { waitingReason: null }, overrideAccess: true })
    lines.push('Decision: the plan was wrong. A revised plan follows through the normal plan gate.')
  } else {
    await payload.update({ collection: 'tickets', id: t.id, data: { waitingReason: null }, overrideAccess: true })
    lines.push(`Decision: needs the owner. Question: ${a.question!.trim()}`)
  }
  await note(payload, t, lines.join('\n'))
  await payload.update({ collection: 'runs', id: run.id, data: { artifacts: { ...(run.artifacts ?? {}), investigation: { decision: a.decision, ...(fixed && { fix: fixed }) } } }, overrideAccess: true })
  return { fix: fixed }
}
