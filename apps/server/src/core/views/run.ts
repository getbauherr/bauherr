import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stageSchema, type Stage } from '../events'
import { RunNotFound } from '../run/errors'
import { loadStatements } from '../run/context'
import { contextSchema, ROLES, type RunStep, type StoredContext } from '../run/schema'
import { readRecord } from '../record/store'
import type { TicketRecord } from '../record/schema'
import { loadRunAttachments, type AttachmentView } from './attachments'
import { loadItem } from './ticket-parts'
import type { Why } from '../memory'

const count = z.coerce.number()

const row = z.object({
  id: count,
  record_id: count,
  stage: stageSchema,
  role: z.enum(ROLES),
  status: z.string(),
  leased_by: z.string().nullable(),
  steps: z.array(z.object({ at: z.string(), text: z.string() })),
  error: z.string().nullable(),
  cost_usd: z.coerce.number().nullable(),
  context: contextSchema.nullable(),
  created_at: z.coerce.date(),
  started_at: z.coerce.date().nullable(),
  finished_at: z.coerce.date().nullable(),
})

export type RunPart = { label: string; detail: string }
export type RunMemory = { id: number; text: string; reason: string }

export type RunPage = {
  id: number
  stage: Stage
  role: string
  status: string
  leasedBy: string | null
  steps: RunStep[]
  error: string | null
  startedAt: string
  finishedAt: string | null
  ticket: { recordId: number; number: number; title: string }
  handoff: string | null
  parts: RunPart[]
  memory: RunMemory[]
  costUsd: number | null
  attachments: AttachmentView[]
}

export type RunFilter = { workspace: number; runId: number; withCost: boolean }

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

const recordDetail = (record: Pick<TicketRecord, 'criteria' | 'decisions'>): string => {
  const criteria = counted(record.criteria.length, 'criterion', 'criteria')
  return `goal, ${criteria}, ${counted(record.decisions.length, 'decision', 'decisions')}`
}

const partsOf = (
  stage: Stage,
  record: Pick<TicketRecord, 'criteria' | 'decisions'>,
  context: StoredContext | null,
): RunPart[] => [
  { label: 'Stage skill', detail: stage },
  { label: 'Record', detail: recordDetail(record) },
  { label: 'Result schema', detail: stage },
  ...(stage === 'intake' ? [{ label: 'Intake facts', detail: 'the issue, its comments, similar issues' }] : []),
  ...(context?.agentsFile.given
    ? [{ label: 'Repository map', detail: context.agentsFile.cut ? 'AGENTS.md, cut' : 'AGENTS.md' }]
    : []),
  ...(context && context.statements.length > 0
    ? [{ label: 'Memory', detail: String(context.statements.length) }]
    : []),
  ...(context && context.similar.length > 0
    ? [{ label: 'Similar tickets', detail: String(context.similar.length) }]
    : []),
]

const REASON_WORDS: Record<Why, string> = { always: 'every ticket', area: 'area', fit: 'fits the ticket' }

const memoryOf = async (payload: Payload, context: StoredContext | null): Promise<RunMemory[]> => {
  const used = await loadStatements(payload, context?.statements ?? [], context?.reasons)
  return used.map(({ id, text, why, area }) => ({
    id,
    text,
    reason: why === 'area' ? `area: ${area ?? ''}` : REASON_WORDS[why],
  }))
}

const handoffOf = (run: { stage: Stage; status: string }, record: Pick<TicketRecord, 'handoff'>): string | null => {
  const ended = ['submitted', 'failed', 'expired'].includes(run.status)
  return ended && run.stage === 'build' && record.handoff !== '' ? record.handoff : null
}

export const runPage = async (payload: Payload, filter: RunFilter): Promise<RunPage> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "record_id", "stage", "role", "status", "leased_by", "steps", "error", "cost_usd", "context",
      "created_at", "started_at", "finished_at"
    FROM "stage_runs" WHERE "id" = ${filter.runId} AND "workspace_id" = ${filter.workspace}`)
  const raw = found.rows[0]
  if (!raw) throw new RunNotFound(`Run ${filter.runId} does not exist: check the id.`)
  const run = row.parse(raw)
  const stored = await readRecord(payload, run.record_id)
  const { repo, number } = stored.record.source
  const issue = await loadItem(payload, { workspace: stored.workspace, repo, number })
  return {
    id: run.id,
    stage: run.stage,
    role: run.role,
    status: run.status,
    leasedBy: run.leased_by,
    steps: run.steps,
    error: run.error,
    startedAt: (run.started_at ?? run.created_at).toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
    ticket: { recordId: stored.id, number, title: issue?.title ?? `#${number}` },
    handoff: handoffOf(run, stored.record),
    parts: partsOf(run.stage, stored.record, run.context),
    memory: await memoryOf(payload, run.context),
    costUsd: filter.withCost ? run.cost_usd : null,
    attachments: await loadRunAttachments(payload, run.id),
  }
}
