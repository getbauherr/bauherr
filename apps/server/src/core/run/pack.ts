import { z } from 'zod'
import { fold } from '../fold'
import { foldOptions } from '../lifecycle'
import type { IntakeFacts } from '../intake/facts'
import { loadIntakeFacts } from '../intake/facts-store'
import type { TicketRecord } from '../record/schema'
import { readEvents, readRecord } from '../record/store'
import type { SubmitDeps } from '../submit'
import { ModuleMissing } from './errors'
import type { Run } from './schema'

export type ContextPack = {
  runId: number
  stage: Run['stage']
  role: Run['role']
  record: TicketRecord
  resultSchema: unknown
  note: string | null
  skill: string | null
  facts: IntakeFacts | null
}

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
  return {
    runId: run.id,
    stage: run.stage,
    role: run.role,
    record: stored.record,
    resultSchema: z.toJSONSchema(module.resultSchema, { io: 'input' }),
    note: await pendingNote(deps, run),
    skill: (await deps.skills?.(run.stage)) ?? null,
    facts: run.stage === 'intake' ? await loadIntakeFacts(deps.payload, stored) : null,
  }
}
