import { STAGES, type Stage } from './needs-you'

type Doc = Record<string, any>
export type RunLine = { id: number; status: string; mode: string; reason: string | null; duration: string | null; costUsd: number | null; createdAt: string; evidence: string }
export type CheckLine = { name: string; state: 'passed' | 'failed' | 'pending' }
export type StageHistoryData = {
  stage: Stage
  runs: RunLine[]
  plan?: { markdown: string | null; decisions: { id: string; title: string; answer: string | null }[] }
  mr?: { url: string; headSha: string | null; checks: CheckLine[] }
  reviews?: { verdict: string | null; findings: number; sha: string | null }[]
  release?: { summary: string | null; accepted: boolean; production: string | null }
}
export type StageHistoryInput = {
  runs: Doc[]
  plan: string | null
  decisions: { id: string; title: string }[]
  answers: Record<string, string>
  mr: { url: string; headSha: string | null; checks: CheckLine[] } | null
  stagingSummary: string | null
  accepted: boolean
  production: string | null
}

/** Stages up to the current one, plus every stage that has a Run. */
export const reachedStages = (ticket: { state?: string | null; stage: Stage }, runs: { stage: string }[]): Stage[] => {
  if (ticket.stage === 'parent') return []
  const at = STAGES.indexOf(ticket.state === 'closed' ? 'done' : ticket.stage)
  return STAGES.filter((s, i) => i <= at || runs.some((r) => r.stage === s))
}

const seconds = (r: Doc) => (r.startedAt && r.finishedAt ? Math.max(0, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000)) : null)
export const formatDuration = (s: number | null): string | null => (s === null ? null : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)
const firstLine = (md: unknown) => (typeof md === 'string' ? md.replace(/[#*`>|-]/g, '').trim().split('\n')[0]!.slice(0, 120) : '')

export const checkLines = (checks: { name: string; status: string; conclusion: string | null }[]): CheckLine[] =>
  checks.map((c) => ({ name: c.name, state: c.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(c.conclusion ?? '') ? 'passed' : 'failed' }))

/** Plain data for the panel of one stage, built from what the Ticket page already loads. */
export const stageHistory = (stage: Stage, i: StageHistoryInput): StageHistoryData => {
  const runs = i.runs.filter((r) => r.stage === stage)
  const out: StageHistoryData = {
    stage,
    runs: runs.map((r) => ({ id: r.id, status: r.status, mode: r.mode, reason: r.error ?? null, duration: formatDuration(seconds(r)), costUsd: r.costUsd ?? null, createdAt: r.createdAt, evidence: firstLine(r.evidence) })),
  }
  if (stage === 'plan') out.plan = { markdown: i.plan, decisions: i.decisions.map((d) => ({ id: d.id, title: d.title, answer: i.answers[d.id] ?? null })) }
  if (stage === 'build' && i.mr) out.mr = i.mr
  if (stage === 'review') out.reviews = runs.filter((r) => r.verdict).map((r) => ({ verdict: r.verdict, findings: Array.isArray(r.findings) ? r.findings.length : 0, sha: r.reviewedSha ?? null }))
  if (stage === 'release' || stage === 'done') out.release = { summary: i.stagingSummary, accepted: i.accepted, production: i.production }
  return out
}
