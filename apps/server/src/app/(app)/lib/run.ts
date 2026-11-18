import { notFound } from 'next/navigation'
import { cache } from 'react'
import { connectedOfRole } from '../../../lib/presence'
import { workflowFor } from '../../../lib/factory'
import { roleOf } from '../../../lib/workflow'
import { payloadClient } from './session'

export const RERUNNABLE = ['failed', 'needs_human', 'cancelled', 'abandoned']
export const STEP_LIMIT = 500

export type RunDoc = {
  id: number
  ticket: number
  stage: string
  kind?: string | null
  status: string
  reasonKind?: string | null
  preemptedFor?: number | null
  preemptAt?: string | null
  mode: string
  sessionOwner: number | null
  agentKey: number | null
  startedAt: string | null
  finishedAt: string | null
  workspace: number
  createdAt: string
  heartbeatAt?: string | null
  model: string | null
  executor: string | null
  sessionLabel: string | null
  outcome: string | null
  clientName: string | null
  clientVersion: string | null
  provider: string | null
  tokensIn: number | null
  tokensOut: number | null
  tokensCache: number | null
  costUsd: number | null
  reconcileStatus: string | null
  gatewayTokensTotal: number | null
  gatewayTokensIn: number | null
  gatewayTokensOut: number | null
  previousRun: number | { id: number } | null
  goal: string[] | null
  costSource: string | null
  evidence: string | null
  error: string | null
  artifacts: { prUrl?: string } | null
  verdict: 'clean' | 'changes' | null
  findings: { severity: string; file: string; line: number; msg: string; scenario: string }[] | null
}
export type StepDoc = { id: number; seq: number | null; summary: string | null; tokensIn: number | null; tokensOut: number | null; at: string }
export type ToolCallDoc = { id: number; step: number; name: string | null; inputDigest: string | null; status: string | null; durationMs: number | null; createdAt: string }

export type SessionInfo = { label: string | null; role: string; publicId: string; lastSeenAt: string | null; disconnectedAt: string | null; endReason: string | null; /** Admin only. */ clientName?: string | null; clientVersion?: string | null; model?: string | null; provider?: string | null }
export type UsageRow = { model: string; source: string; tokensIn: number | null; tokensOut: number | null; cacheRead: number | null; cacheWrite: number | null; costUsd: number | null }
type TicketDoc = { id: number; number: number; title: string; url?: string | null; stage: string | null; state: string | null; labels: string[] | null; releaseState: string | null; product: number; waitingFor?: string | null; reviewState?: string | null; releaseChecksState?: string | null; ciSummary?: unknown }

const PUBLIC_RUN_KEYS = ['id', 'ticket', 'stage', 'kind', 'status', 'reasonKind', 'preemptedFor', 'preemptAt', 'mode', 'createdAt', 'startedAt', 'finishedAt', 'heartbeatAt', 'workspace', 'executor', 'sessionLabel', 'session', 'outcome', 'previousRun', 'evidence', 'error', 'artifacts', 'verdict', 'findings'] as const
const PUBLIC_TICKET_KEYS = ['id', 'number', 'title', 'url', 'stage', 'state', 'labels', 'releaseState', 'product', 'waitingFor', 'reviewState', 'releaseChecksState', 'ciSummary'] as const
const pick = <T extends object>(o: T, keys: readonly string[]): T => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, (o as Record<string, unknown>)[k]])) as T

export const publicRun = (run: RunDoc): RunDoc => pick(run, PUBLIC_RUN_KEYS)

export const loadRun = cache(async (workspace: number, id: string, isAdmin: boolean) => {
  if (!/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const inWs = { workspace: { equals: workspace } }
  const [run] = (await payload.find({ collection: 'runs', where: { and: [{ id: { equals: id } }, inWs] }, limit: 1, ...q })).docs as unknown as (RunDoc & { session?: number | null; escalation?: { previousRuns?: number[] } | null; investigation?: { failedRuns?: number[] } | null })[]
  if (!run) notFound()
  const wf = workflowFor(workspace)
  const role = roleOf(wf, run.stage)?.id
  const relatedIds = [...(run.escalation?.previousRuns ?? []), ...(run.investigation?.failedRuns ?? [])]
  const [[ticket], steps, owner, agentKey, next, sessionDoc, connected, related, usage] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [{ id: { equals: run.ticket } }, inWs] }, limit: 1, ...q }).then((r) => r.docs as unknown as TicketDoc[]),
    payload.find({ collection: 'steps', where: { run: { equals: run.id } }, sort: 'seq', limit: STEP_LIMIT, ...q }).then((r) => ({ total: r.totalDocs, docs: (r.docs as unknown as (StepDoc & { startedAt?: string; createdAt: string })[]).map((s) => ({ ...(isAdmin ? s : { id: s.id, seq: s.seq, summary: s.summary }), at: s.startedAt ?? s.createdAt }) as StepDoc) })),
    isAdmin && run.sessionOwner ? payload.findByID({ collection: 'bauherren', id: run.sessionOwner, ...q }).catch(() => null) : null,
    isAdmin && run.agentKey ? payload.findByID({ collection: 'agent_keys', id: run.agentKey, ...q }).catch(() => null) : null,
    payload.find({ collection: 'runs', where: { and: [{ previousRun: { equals: run.id } }, inWs] }, sort: 'id', pagination: false, select: { id: true }, ...q }).then((r) => r.docs.map((d) => d.id as number)),
    run.session ? payload.find({ collection: 'agent_sessions', where: { and: [{ id: { equals: run.session } }, inWs] }, limit: 1, ...q }).then((r) => (r.docs[0] ?? null) as Record<string, any> | null) : null,
    run.status === 'awaiting_session' && role ? connectedOfRole(payload, workspace, role) : 0,
    relatedIds.length ? payload.find({ collection: 'runs', where: { and: [{ id: { in: relatedIds } }, inWs] }, pagination: false, select: { id: true }, ...q }).then((r) => new Set(r.docs.map((d) => d.id as number))) : new Set<number>(),
    isAdmin ? payload.find({ collection: 'usage_entries', where: { run: { equals: run.id } }, sort: 'model', pagination: false, ...q }).then((r) => r.docs as unknown as UsageRow[]) : [],
  ])
  if (!ticket) notFound()
  const calls = isAdmin && steps.docs.length ? ((await payload.find({ collection: 'tool_calls', where: { step: { in: steps.docs.map((s) => s.id) } }, sort: 'createdAt', limit: 2000, ...q })).docs as unknown as ToolCallDoc[]) : []
  const session: SessionInfo | null = sessionDoc && {
    label: sessionDoc.label ?? null,
    role: sessionDoc.role,
    publicId: sessionDoc.publicId,
    lastSeenAt: sessionDoc.lastSeenAt ?? null,
    disconnectedAt: sessionDoc.disconnectedAt ?? null,
    endReason: sessionDoc.endReason ?? null,
    ...(isAdmin && { clientName: sessionDoc.clientName ?? null, clientVersion: sessionDoc.clientVersion ?? null, model: sessionDoc.model ?? null, provider: sessionDoc.provider ?? null }),
  }
  return {
    run: isAdmin ? run : publicRun(run),
    ticket: pick(ticket, PUBLIC_TICKET_KEYS),
    session,
    connected,
    steps: steps.docs,
    stepsTotal: steps.total,
    chain: {
      previous: typeof run.previousRun === 'object' ? (run.previousRun?.id ?? null) : run.previousRun,
      next,
      escalation: (run.escalation?.previousRuns ?? []).filter((n) => related.has(n)),
      investigation: (run.investigation?.failedRuns ?? []).filter((n) => related.has(n)),
    },
    admin: isAdmin
      ? {
          callsByStep: calls.reduce((m, c) => m.set(c.step, [...(m.get(c.step) ?? []), c]), new Map<number, ToolCallDoc[]>()),
          owner: (owner as { email?: string } | null)?.email ?? null,
          agentKeyLabel: (agentKey as { label?: string } | null)?.label ?? null,
          usage,
        }
      : null,
  }
})

export const durationMs = (from: string | null, to: string | null) => (from && to ? Math.max(0, +new Date(to) - +new Date(from)) : null)

export const fmtDuration = (ms: number | null) => {
  if (ms == null) return '—'
  ms = Math.max(0, ms)
  const s = Math.round(ms / 1000)
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : ms < 1000 ? `${ms}ms` : `${s}s`
}
