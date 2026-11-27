import { z } from 'zod'
import { fold } from '../fold'
import { foldOptions } from '../lifecycle'
import { moduleKey } from '../module'
import { commentFilesOf, type CommentFile } from '../conversations/store'
import type { IntakeFacts } from '../intake/facts'
import { loadIntakeFacts } from '../intake/facts-store'
import { handOver, unseenComments, type NewComment } from '../requests/handover'
import type { MemoryPart } from '../memory-documents'
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
  newComments: NewComment[]
  skill: string | null
  facts: IntakeFacts | null
  source: PackSource | null
  agentsFile: ContextParts['agentsFile']
  memory: MemoryPart[]
  similar: PackSimilar[]
}

const pendingNote = async (deps: SubmitDeps, run: Run): Promise<string | null> => {
  const events = await readEvents(deps.payload, run.recordId)
  const started = events.findIndex((e) => e.type === 'run.started' && e.data.runId === String(run.id))
  const options = foldOptions(await deps.configFor(run.recordId))
  return fold(started < 0 ? events : events.slice(0, started), options).note
}

const newCommentsOf = (deps: SubmitDeps, run: Run, deliver: boolean): Promise<NewComment[]> =>
  deliver ? handOver(deps.payload, run.recordId, run.id) : unseenComments(deps.payload, run.recordId)

const modelOf = async (deps: SubmitDeps, run: Run) => ({ tier: (await deps.tiers?.(run.role)) ?? DEFAULT_TIER })

const skillOf = async (deps: SubmitDeps, run: Run) => (await deps.skills?.(run.stage, run.role)) ?? null

export const contextPack = async (
  deps: SubmitDeps,
  run: Run,
  options: { deliver: boolean } = { deliver: true },
): Promise<ContextPack> => {
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
    model: await modelOf(deps, run),
    record: recordFor(run.role, stored.record),
    resultSchema: z.toJSONSchema(module.resultSchema, { io: 'input' }),
    note: await pendingNote(deps, run),
    commentFiles: await commentFilesOf(deps.payload, run.recordId),
    newComments: await newCommentsOf(deps, run, options.deliver),
    skill: await skillOf(deps, run),
    facts: run.stage === 'intake' ? await loadIntakeFacts(deps.payload, stored) : null,
    source: await loadSource(deps.payload, stored),
    agentsFile: parts.agentsFile,
    memory: context.memory ?? [],
    similar: parts.similar,
  }
}
