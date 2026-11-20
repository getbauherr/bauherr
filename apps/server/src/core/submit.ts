import type { z } from 'zod'
import { inLockedRecord, type Conn } from './conn'
import { runEffects } from './effects'
import { advance, type AdvanceDeps } from './engine'
import type { Effect, LifecycleModule, Modules, Problem } from './module'
import {
  CriteriaEditNotAllowed,
  FieldNotWritable,
  InvalidPatch,
  ProofRequired,
  StatusChangeNotAllowed,
} from './record/errors'
import { appendEvent, patchRecord, readRecord } from './record/store'
import { ModuleMissing } from './run/errors'
import { authorize, expire, release, type Expired } from './run/leases'
import type { Run } from './run/schema'
import { finishRun, markRefused, readRun } from './run/store'

export type SubmitDeps = AdvanceDeps & { modules: Modules }
export type SubmitResult = { status: 'accepted' } | { status: 'retry' | 'failed'; problems: Problem[] }
type Accepted = { status: 'accepted'; effects: Effect[] }
type Refused = Exclude<SubmitResult, { status: 'accepted' }>
type Locked = Accepted | Refused

const REFUSALS = [FieldNotWritable, InvalidPatch, StatusChangeNotAllowed, ProofRequired, CriteriaEditNotAllowed]

const problemsOf = (error: z.ZodError): Problem[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))

const refusalOf = (error: unknown): Problem[] | null =>
  REFUSALS.some((refusal) => error instanceof refusal) && error instanceof Error
    ? [{ path: '', message: error.message }]
    : null

const released = (conn: Conn, run: { id: number; recordId: number; stage: Run['stage'] }) =>
  appendEvent(conn, run.recordId, {
    type: 'run.released',
    data: { stage: run.stage, runId: String(run.id) },
    actor: 'factory',
  })

const refuse = async (tx: Conn, run: Run, problems: Problem[], now: Date): Promise<Refused> => {
  if (run.attempt === 0) {
    await markRefused(tx, run.id)
    return { status: 'retry', problems }
  }
  await finishRun(tx, run.id, { status: 'failed', error: JSON.stringify(problems), now })
  await appendEvent(tx, run.recordId, {
    type: 'run.failed',
    data: { stage: run.stage, runId: String(run.id), reason: 'invalid-result' },
    actor: 'factory',
  })
  return { status: 'failed', problems }
}

type Written = { problems: Problem[] } | { effects: Effect[] }

const write = async (tx: Conn, run: Run, module: LifecycleModule, data: unknown): Promise<Written> => {
  const stored = await readRecord(tx, run.recordId)
  try {
    const applied = module.apply(stored.record, data, run)
    const by = { stage: run.stage, runId: String(run.id) }
    const input = { expectedVersion: stored.version, writes: module.writes, patch: applied.patch, by }
    await patchRecord(tx, run.recordId, input)
    for (const event of applied.events) await appendEvent(tx, run.recordId, { ...event, actor: 'agent' })
    return { effects: applied.effects ?? [] }
  } catch (error) {
    const problems = refusalOf(error)
    if (problems) return { problems }
    throw error
  }
}

const submitLocked = async (tx: Conn, run: Run, token: string, rawResult: unknown, deps: SubmitDeps) => {
  const current = await authorize(tx, run.id, token)
  const module = deps.modules[current.stage]
  if (!module) throw new ModuleMissing(`No module is registered for stage ${current.stage}: register one.`)
  const parsed = module.resultSchema.safeParse(rawResult)
  if (!parsed.success) return refuse(tx, current, problemsOf(parsed.error), deps.now)
  const written = await write(tx, current, module, parsed.data)
  if ('problems' in written) return refuse(tx, current, written.problems, deps.now)
  await finishRun(tx, current.id, { status: 'submitted', result: parsed.data, now: deps.now })
  return { status: 'accepted', effects: written.effects } satisfies Accepted
}

export const submit = async (
  runId: number,
  token: string,
  rawResult: unknown,
  deps: SubmitDeps,
): Promise<SubmitResult> => {
  const run = await readRun(deps.payload, runId)
  const locked: Locked = await inLockedRecord(deps.payload, run.recordId, (tx) =>
    submitLocked(tx, run, token, rawResult, deps),
  )
  if (locked.status === 'accepted') await runEffects(deps, run.recordId, locked.effects)
  if (locked.status !== 'retry') await advance(run.recordId, deps)
  return locked.status === 'accepted' ? { status: 'accepted' } : locked
}

export const releaseRun = async (runId: number, token: string, deps: AdvanceDeps): Promise<void> => {
  const run = await release(deps.payload, runId, token, deps.now)
  await released(deps.payload, run)
  await advance(run.recordId, deps)
}

export const expireRuns = async (deps: AdvanceDeps): Promise<Expired[]> => {
  const expired = await expire(deps.payload, deps.now)
  for (const run of expired) {
    await released(deps.payload, { id: run.runId, recordId: run.recordId, stage: run.stage })
  }
  for (const recordId of new Set(expired.map((run) => run.recordId))) await advance(recordId, deps)
  return expired
}
