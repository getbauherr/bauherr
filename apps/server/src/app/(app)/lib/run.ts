import { notFound } from 'next/navigation'
import { cache } from 'react'
import { workflowStages } from '../../../lib/mode'
import { STAGES } from './needs-you'
import { payloadClient } from './session'

export const RERUNNABLE = ['failed', 'needs_human']
export const STEP_LIMIT = 500

export type RunDoc = {
  id: number
  ticket: number
  stage: string
  status: string
  mode: string
  sessionOwner: number | null
  startedAt: string | null
  finishedAt: string | null
  workspace: number
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  tokensCache: number | null
  costUsd: number | null
  costSource: string | null
  evidence: string | null
  error: string | null
  artifacts: { prUrl?: string } | null
}
export type StepDoc = { id: number; seq: number | null; summary: string | null; tokensIn: number | null; tokensOut: number | null; at: string }
export type ToolCallDoc = { id: number; step: number; name: string | null; inputDigest: string | null; status: string | null; durationMs: number | null; createdAt: string }

/** Run (404 outside the Workspace) with its Ticket, the Ticket's latest Run per stage, Steps and their tool calls. D5: no extra tables. */
export const loadRun = cache(async (workspace: number, id: string) => {
  if (!/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const inWs = { workspace: { equals: workspace } }
  const [run] = (await payload.find({ collection: 'runs', where: { and: [{ id: { equals: id } }, inWs] }, limit: 1, ...q })).docs as unknown as RunDoc[]
  if (!run) notFound()
  const [[ticket], siblings, steps, owner] = await Promise.all([
    payload.find({ collection: 'tickets', where: { and: [{ id: { equals: run.ticket } }, inWs] }, limit: 1, ...q }).then((r) => r.docs as unknown as { id: number; number: number; title: string; stage: string | null; state: string | null; labels: string[] | null; releaseState: string | null }[]),
    payload.find({ collection: 'runs', where: { ticket: { equals: run.ticket } }, sort: '-createdAt', limit: 50, ...q }).then((r) => r.docs as unknown as RunDoc[]),
    payload.find({ collection: 'steps', where: { run: { equals: run.id } }, sort: 'seq', limit: STEP_LIMIT, ...q }).then((r) => ({ total: r.totalDocs, docs: (r.docs as unknown as (StepDoc & { startedAt?: string; createdAt: string })[]).map((s) => ({ ...s, at: s.startedAt ?? s.createdAt })) })),
    run.sessionOwner ? payload.findByID({ collection: 'bauherren', id: run.sessionOwner, ...q }).catch(() => null) : null,
  ])
  if (!ticket) notFound()
  const calls = steps.docs.length ? ((await payload.find({ collection: 'tool_calls', where: { step: { in: steps.docs.map((s) => s.id) } }, sort: 'createdAt', limit: 2000, ...q })).docs as unknown as ToolCallDoc[]) : []
  const stageNames = workflowStages()
  const latestByStage = new Map<string, RunDoc>()
  for (const r of siblings) if (!latestByStage.has(r.stage)) latestByStage.set(r.stage, r)
  return {
    run,
    ticket,
    stages: stageNames.length ? stageNames : [...STAGES],
    latestByStage,
    steps: steps.docs,
    stepsTotal: steps.total,
    callsByStep: calls.reduce((m, c) => m.set(c.step, [...(m.get(c.step) ?? []), c]), new Map<number, ToolCallDoc[]>()),
    owner: (owner as { email?: string } | null)?.email ?? null,
  }
})

export const durationMs = (from: string | null, to: string | null) => (from && to ? Math.max(0, +new Date(to) - +new Date(from)) : null)

export const fmtDuration = (ms: number | null) => {
  if (ms == null) return '—'
  ms = Math.max(0, ms)
  const s = Math.round(ms / 1000)
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : ms < 1000 ? `${ms}ms` : `${s}s`
}
