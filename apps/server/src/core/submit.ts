import type { z } from 'zod'
import { advance, type AdvanceDeps } from './engine'
import type { Applied, LifecycleModule, Modules, Problem } from './module'
import {
  CriteriaEditNotAllowed,
  FieldNotWritable,
  InvalidPatch,
  ProofRequired,
  StatusChangeNotAllowed,
  VersionConflict,
} from './record/errors'
import { appendEvent, patchRecord, readRecord } from './record/store'
import { ModuleMissing } from './run/errors'
import { authorize, expire, release, type Expired } from './run/leases'
import type { Run } from './run/schema'
import { finishRun, markRefused } from './run/store'

export type SubmitDeps = AdvanceDeps & { modules: Modules }
export type SubmitResult = { status: 'accepted' } | { status: 'retry' | 'failed'; problems: Problem[] }

const REFUSALS = [FieldNotWritable, InvalidPatch, StatusChangeNotAllowed, ProofRequired, CriteriaEditNotAllowed]

const problemsOf = (error: z.ZodError): Problem[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))

const refusalOf = (error: unknown): Problem[] | null =>
  REFUSALS.some((refusal) => error instanceof refusal) && error instanceof Error
    ? [{ path: '', message: error.message }]
    : null

const released = (deps: AdvanceDeps, run: { id: number; recordId: number; stage: Run['stage'] }) =>
  appendEvent(deps.payload, run.recordId, {
    type: 'run.released',
    data: { stage: run.stage, runId: String(run.id) },
    actor: 'factory',
  })

const refuse = async (run: Run, problems: Problem[], deps: SubmitDeps): Promise<SubmitResult> => {
  if (run.attempt === 0) {
    await markRefused(deps.payload, run.id)
    return { status: 'retry', problems }
  }
  await finishRun(deps.payload, run.id, { status: 'failed', error: JSON.stringify(problems), now: deps.now })
  await appendEvent(deps.payload, run.recordId, {
    type: 'run.failed',
    data: { stage: run.stage, runId: String(run.id), reason: 'invalid-result' },
    actor: 'factory',
  })
  await advance(run.recordId, deps)
  return { status: 'failed', problems }
}

const writeOnce = async (run: Run, module: LifecycleModule, data: unknown, deps: SubmitDeps) => {
  const stored = await readRecord(deps.payload, run.recordId)
  let applied: Applied
  try {
    applied = module.apply(stored.record, data, run)
    const by = { stage: run.stage, runId: String(run.id) }
    const input = { expectedVersion: stored.version, writes: module.writes, patch: applied.patch, by }
    await patchRecord(deps.payload, run.recordId, input)
  } catch (error) {
    const problems = refusalOf(error)
    if (problems) return problems
    throw error
  }
  for (const event of applied.events) await appendEvent(deps.payload, run.recordId, { ...event, actor: 'agent' })
  return null
}

const write = async (run: Run, token: string, module: LifecycleModule, data: unknown, deps: SubmitDeps) => {
  try {
    return await writeOnce(run, module, data, deps)
  } catch (error) {
    if (!(error instanceof VersionConflict)) throw error
    await authorize(deps.payload, run.id, token)
    return writeOnce(run, module, data, deps)
  }
}

export const submit = async (
  runId: number,
  token: string,
  rawResult: unknown,
  deps: SubmitDeps,
): Promise<SubmitResult> => {
  const run = await authorize(deps.payload, runId, token)
  const module = deps.modules[run.stage]
  if (!module) throw new ModuleMissing(`No module is registered for stage ${run.stage}: register one.`)
  const parsed = module.resultSchema.safeParse(rawResult)
  if (!parsed.success) return refuse(run, problemsOf(parsed.error), deps)
  const problems = await write(run, token, module, parsed.data, deps)
  if (problems) return refuse(run, problems, deps)
  await finishRun(deps.payload, run.id, { status: 'submitted', result: parsed.data, now: deps.now })
  await advance(run.recordId, deps)
  return { status: 'accepted' }
}

export const releaseRun = async (runId: number, token: string, deps: AdvanceDeps): Promise<void> => {
  const run = await release(deps.payload, runId, token, deps.now)
  await released(deps, run)
  await advance(run.recordId, deps)
}

export const expireRuns = async (deps: AdvanceDeps): Promise<Expired[]> => {
  const expired = await expire(deps.payload, deps.now)
  for (const run of expired) await released(deps, { id: run.runId, recordId: run.recordId, stage: run.stage })
  for (const recordId of new Set(expired.map((run) => run.recordId))) await advance(recordId, deps)
  return expired
}
