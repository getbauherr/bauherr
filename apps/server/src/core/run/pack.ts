import { z } from 'zod'
import { fold } from '../fold'
import { foldOptions } from '../lifecycle'
import type { IntakeFacts } from '../intake/facts'
import { loadIntakeFacts } from '../intake/facts-store'
import type { StatementKind } from '../statements'
import type { TicketRecord } from '../record/schema'
import { readEvents, readRecord } from '../record/store'
import type { SubmitDeps } from '../submit'
import { partsOf, rememberContext, selectContext, type ContextParts, type PackSimilar } from './context'
import { ModuleMissing } from './errors'
import { recordFor } from './role-view'
import { DEFAULT_TIER, type Run, type Tier } from './schema'

export type ContextPack = {
  runId: number
  stage: Run['stage']
  role: Run['role']
  model: { tier: Tier }
  record: TicketRecord
  resultSchema: unknown
  note: string | null
  skill: string | null
  facts: IntakeFacts | null
  agentsFile: ContextParts['agentsFile']
  statements: PackStatement[]
  similar: PackSimilar[]
}

export type PackStatement = { id: number; kind: StatementKind; text: string; ticket: number; at: string }

const pendingNote = async (deps: SubmitDeps, run: Run): Promise<string | null> => {
  const events = await readEvents(deps.payload, run.recordId)
  const started = events.findIndex((e) => e.type === 'run.started' && e.data.runId === String(run.id))
  const options = foldOptions(await deps.configFor(run.recordId))
  return fold(started < 0 ? events : events.slice(0, started), options).note
}

export const contextPack = async (deps: SubmitDeps, run: Run): Promise<ContextPack> => {
  const module = deps.modules[run.stage]
  if (!module) {
    throw new ModuleMissing(`No module is registered for stage ${run.stage} yet: nothing can be worked here.`)
  }
  const stored = await readRecord(deps.payload, run.recordId)
  const context =
    run.context ?? (await rememberContext(deps.payload, run.id, await selectContext(deps.payload, run.stage, stored)))
  const parts = await partsOf(deps.payload, stored, context)
  return {
    runId: run.id,
    stage: run.stage,
    role: run.role,
    model: { tier: (await deps.tiers?.(run.role)) ?? DEFAULT_TIER },
    record: recordFor(run.role, stored.record),
    resultSchema: z.toJSONSchema(module.resultSchema, { io: 'input' }),
    note: await pendingNote(deps, run),
    skill: (await deps.skills?.(run.stage)) ?? null,
    facts: run.stage === 'intake' ? await loadIntakeFacts(deps.payload, stored) : null,
    agentsFile: parts.agentsFile,
    statements: parts.statements.map(({ id, kind, text, ticket, at }) => ({ id, kind, text, ticket, at })),
    similar: parts.similar,
  }
}
