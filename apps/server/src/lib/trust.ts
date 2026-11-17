import { proofRules } from '@bauherr/runner'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { loadProof } from '../app/(app)/lib/proof'
import { ciSummaryOf } from './ci-summary'
import { costSplit } from './cost'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0, pagination: false } as const

export const GRADES = ['A', 'B', 'C', 'D'] as const
export type Grade = (typeof GRADES)[number]
export type TrustLine = { text: string; pass: boolean | null }
export type TrustGroup = { id: 'checks' | 'proof' | 'review' | 'interventions'; label: string; pass: boolean | null; lines: TrustLine[] }
export type SendBack = { stage: string; by: 'review' | 'human' }
export type TicketTrust = {
  grade: Grade
  groups: TrustGroup[]
  cost: { usd: number; estimated: boolean; unreported: number; vsMedian: number | null }
  facts: { interventions: number; sendBacks: SendBack[] }
}

export const MAX_CLEAN_REVIEW_ROUNDS = 1
export const MEDIAN_DAYS = 90
export const ESCAPE_DAYS = 30
export const EARNED = { days: 28, minDone: 5, maxEscaped: 0, maxRework: 0.05 }
const PLANNED_GATE = /^gate:(approve:plan|accept:staging|approve:production|decide:)/
const STAGING_LABEL = 'bauherr:approved:staging'

export const gradeOf = (groups: { pass: boolean | null }[]): Grade => GRADES[Math.min(groups.filter((g) => g.pass === false).length, GRADES.length - 1)]!

export const passOf = (lines: { pass: boolean | null }[]): boolean | null => (lines.some((l) => l.pass === false) ? false : lines.some((l) => l.pass === true) ? true : null)

export const isBug = (labels: readonly string[] | null | undefined): boolean => !!labels?.some((l) => l === 'bauherr:type:bug' || l === 'type:bug')

export const isIntervention = (e: { executor?: string | null; phase?: string | null; cause?: string | null }): boolean => e.executor === 'human' && e.phase !== 'human' && !PLANNED_GATE.test(e.cause ?? '')

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const ciLine = (t: Doc): TrustLine => {
  const live = ciSummaryOf(t)?.summary
  if (live) return { text: `CI on the open head: ${live.passed} of ${live.total} checks passed${live.failed.length ? `, failed: ${live.failed.join(', ')}` : ''}`, pass: live.pending > 0 ? null : live.failed.length === 0 && live.total > 0 }
  const brief = (t.approvalBrief?.checks?.ci as string | null | undefined) ?? null
  const m = brief && /(\d+) of (\d+) checks passed(, failed:)?/.exec(brief)
  return m ? { text: brief.replace(/^CI: /, 'CI on the merged head: '), pass: m[1] === m[2] && !m[3] && Number(m[2]) > 0 } : { text: 'No CI result recorded for this Ticket', pass: null }
}

const proofLines = async (payload: Payload, t: Doc, product: Doc): Promise<TrustLine[]> => {
  const data = (await loadProof(payload, [t], new Map([[product.id, product]]))).get(t.id)
  if (!data && !proofRules(product.reviewChecks, product.pathSets).length) return []
  const rows = data?.rows ?? []
  const lines: TrustLine[] = rows.map((r) => ({ text: `${r.criterion ?? 'Other proof'}: ${r.items.length ? plural(r.items.length, 'item') : 'no proof'}`, pass: r.items.length > 0 }))
  for (const w of data?.waived ?? []) lines.push({ text: `No proof for ${w.rule}: ${w.reason || 'no reason given'}`, pass: false })
  return lines.length ? lines : [{ text: 'The Product asks for proof; none is attached', pass: false }]
}

const reviewLines = (t: Doc, runs: Doc[]): TrustLine[] => {
  const reviews = runs.filter((r) => r.kind === 'review' && r.status === 'succeeded').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const changes = reviews.filter((r) => r.verdict === 'changes')
  const rounds = Math.max(changes.length, Number(t.reviewRounds ?? 0))
  const escalations = runs.filter((r) => r.escalation).length
  const lines: TrustLine[] = []
  if (!reviews.length && !rounds) lines.push({ text: 'No review Run yet', pass: null })
  else {
    lines.push({ text: rounds ? `Review sent it back ${plural(rounds, 'time')}` : 'Review did not send it back', pass: rounds <= MAX_CLEAN_REVIEW_ROUNDS })
    const important = changes.flatMap((r) => (r.findings ?? []) as Doc[]).filter((f) => f.class !== 'low').length
    if (important) {
      const fixed = reviews.at(-1)?.verdict === 'clean'
      lines.push({ text: `${plural(important, 'Important finding')} found, ${fixed ? 'fixed (the final review is clean)' : 'not yet confirmed fixed'}`, pass: fixed ? true : t.state === 'closed' ? false : null })
    }
  }
  lines.push({ text: escalations ? `Escalated ${plural(escalations, 'time')}` : 'No escalations', pass: escalations === 0 })
  return lines
}

const medianCost = async (payload: Payload, product: number, now: number): Promise<number | null> => {
  const rows = (await payload.db.drizzle.execute(sql`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY c)::float8 AS "median" FROM (
      SELECT sum(COALESCE(r."gateway_cost_usd", r."cost_estimate_usd", 0)) AS c FROM "tickets" t JOIN "runs" r ON r."ticket_id" = t."id"
      WHERE t."product_id" = ${product}::int AND EXISTS (SELECT 1 FROM "ticket_events" e WHERE e."ticket_id" = t."id" AND e."phase" = 'closed' AND e."at" >= ${new Date(now - MEDIAN_DAYS * 864e5).toISOString()}::timestamptz)
      GROUP BY t."id") x WHERE c > 0`)).rows as { median: number | null }[]
  return rows[0]?.median ?? null
}

export const ticketTrust = async (payload: Payload, ticketId: number, now = Date.now()): Promise<TicketTrust> => {
  const t = (await payload.findByID({ collection: 'tickets', id: ticketId, ...o })) as Doc
  const pid = typeof t.product === 'object' ? t.product.id : t.product
  const [product, runs, events] = await Promise.all([
    payload.findByID({ collection: 'products', id: pid, ...o }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { ticket: { equals: ticketId } }, sort: 'createdAt', ...o }).then((r) => r.docs as Doc[]),
    payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticketId } }, sort: 'at', ...o }).then((r) => r.docs as Doc[]),
  ])
  const accepted = (t.labels as string[] | undefined)?.includes(STAGING_LABEL) || events.some((e) => e.cause === 'gate:accept:staging')
  const closed = t.state === 'closed'
  const staging: TrustLine[] = product.stagingUrl ? [{ text: accepted ? 'Staging accepted' : closed ? 'Staging was not accepted' : 'Staging not accepted yet', pass: accepted ? true : closed ? false : null }] : []
  const interventions = events.filter(isIntervention)
  const byReview = runs.filter((r) => r.kind === 'review' && r.verdict === 'changes').map((r): SendBack => ({ stage: r.stage, by: 'review' }))
  const byHuman = events.filter((e) => e.cause === 'sendBack').map((e): SendBack => ({ stage: e.fromStage ?? e.stage ?? 'unknown', by: 'human' }))
  const sendBacks = byReview.concat(byHuman)
  const lines = {
    checks: [ciLine(t)],
    proof: [...(await proofLines(payload, t, product)), ...staging],
    review: reviewLines(t, runs),
    interventions: [{ text: interventions.length ? `${plural(interventions.length, 'human intervention')} outside the planned gates` : 'No human intervention outside the planned gates', pass: interventions.length === 0 }],
  }
  const groups: TrustGroup[] = (['checks', 'proof', 'review', 'interventions'] as const).map((id) => ({ id, label: { checks: 'Checks', proof: 'Proof', review: 'Review', interventions: 'Interventions' }[id], pass: passOf(lines[id]), lines: lines[id] }))
  const { priced, unreported, estimated, total } = costSplit(runs)
  const median = await medianCost(payload, pid, now)
  return { grade: gradeOf(groups), groups, cost: { usd: total, estimated, unreported: unreported.length, vsMedian: median && priced.length ? total / median : null }, facts: { interventions: interventions.length, sendBacks } }
}

export type EarnedAutonomy = { met: boolean; text: string }

export const earnedAutonomy = (m: { done: number; escaped: number; reworkRate: number }, days: number): EarnedAutonomy => {
  const weeks = Math.round(EARNED.days / 7)
  const rule = `${EARNED.maxEscaped} escaped defects and under ${Math.round(EARNED.maxRework * 100)} % rework over ${weeks} weeks`
  if (days < EARNED.days || m.done < EARNED.minDone) return { met: false, text: `Not enough history to say whether Review could rely on proof: needs ${EARNED.minDone} done Tickets and ${rule}` }
  const met = m.escaped <= EARNED.maxEscaped && m.reworkRate < EARNED.maxRework
  return { met, text: met ? `Review could rely on proof: ${rule}` : `Review keeps its role: ${m.escaped} escaped ${m.escaped === 1 ? 'defect' : 'defects'} and ${Math.round(m.reworkRate * 100)} % rework; relying on proof needs ${rule}` }
}
