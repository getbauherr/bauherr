import { z } from 'zod'
import { fold } from '../fold'
import { foldOptions } from '../lifecycle'
import { moduleKey } from '../module'
import { commentFilesOf, type CommentFile } from '../conversations/store'
import type { IntakeFacts } from '../intake/facts'
import { loadIntakeFacts } from '../intake/facts-store'
import type { Why } from '../memory'
import type { MemoryPart } from '../memory-documents'
import type { StatementKind } from '../statements'
import type { TicketRecord } from '../record/schema'
import { readEvents, readRecord } from '../record/store'
import type { SubmitDeps } from '../submit'
import { partsOf, rememberContext, selectContext, type ContextParts, type PackSimilar } from './context'
import { ModuleMissing } from './errors'
import { recordFor } from './role-view'
import { DEFAULT_TIER, type Run, type Tier } from './schema'
import { loadSource, type PackSource } from './source'

export type ContextPack = {
  runId: number
  stage: Run['stage']
  role: Run['role']
  model: { tier: Tier }
  record: TicketRecord
  resultSchema: unknown
  note: string | null
  commentFiles: CommentFile[]
  skill: string | null
  facts: IntakeFacts | null
  source: PackSource | null
  agentsFile: ContextParts['agentsFile']
  memory: MemoryPart[]
  statements: PackStatement[]
  similar: PackSimilar[]
}

export type PackStatement = {
  id: number
  kind: StatementKind
  why: Why
  text: string
  ticket: number | null
  at: string
}

const pendingNote = async (deps: SubmitDeps, run: Run): Promise<string | null> => {
  const events = await readEvents(deps.payload, run.recordId)
  const started = events.findIndex((e) => e.type === 'run.started' && e.data.runId === String(run.id))
  const options = foldOptions(await deps.configFor(run.recordId))
  return fold(started < 0 ? events : events.slice(0, started), options).note
}

export const contextPack = async (deps: SubmitDeps, run: Run): Promise<ContextPack> => {
  const module = deps.modules[moduleKey(run.stage, run.role)]
  if (!module) {
    throw new ModuleMissing(`No module is registered for stage ${run.stage} yet: nothing can be worked here.`)
  }
  const stored = await readRecord(deps.payload, run.recordId)
  const context =
    run.context ?? (await rememberContext(deps.payload, run.id, await selectContext(deps.payload, run, stored)))
  const parts = await partsOf(deps.payload, stored, context)
  return {
    runId: run.id,
    stage: run.stage,
    role: run.role,
    model: { tier: (await deps.tiers?.(run.role)) ?? DEFAULT_TIER },
    record: recordFor(run.role, stored.record),
    resultSchema: z.toJSONSchema(module.resultSchema, { io: 'input' }),
    note: await pendingNote(deps, run),
    commentFiles: await commentFilesOf(deps.payload, run.recordId),
    skill: (await deps.skills?.(run.stage, run.role)) ?? null,
    facts: run.stage === 'intake' ? await loadIntakeFacts(deps.payload, stored) : null,
    source: await loadSource(deps.payload, stored),
    agentsFile: parts.agentsFile,
    memory: context.memory ?? [],
    statements: parts.statements.map(({ id, kind, why, text, ticket, at }) => ({ id, kind, why, text, ticket, at })),
    similar: parts.similar,
  }
}
