import type { z } from 'zod'
import { inLockedRecord, type Conn } from './conn'
import { runEffects } from './effects'
import type { Stage } from './events'
import { advance, type AdvanceDeps } from './engine'
import { fold } from './fold'
import { gate } from './gate'
import { loadGateFacts } from './gate-facts'
import { foldOptions } from './lifecycle'
import type { Effect, LifecycleModule, Modules, Problem } from './module'
import {
  CriteriaEditNotAllowed,
  FieldNotWritable,
  InvalidPatch,
  ProofRequired,
  StatusChangeNotAllowed,
} from './record/errors'
import { appendEvent, patchRecord, readEvents, readRecord } from './record/store'
import { verifyResultSchema } from './verify-result'
import { ModuleMissing, RecordClosed } from './run/errors'
import { authorize, expire, release, type Expired } from './run/leases'
import type { Run } from './run/schema'
import { finishRun, markRefused, readRun } from './run/store'

export type SkillLoader = (stage: Stage) => Promise<string | null>
export type SubmitDeps = AdvanceDeps & { modules: Modules; skills?: SkillLoader }
export type SubmitResult = { status: 'accepted' } | { status: 'retry' | 'failed'; problems: Problem[] }
type Accepted = { status: 'accepted'; effects: Effect[] }
type Refused = Exclude<SubmitResult, { status: 'accepted' }>
type Locked = Accepted | Refused

const REFUSALS = [FieldNotWritable, InvalidPatch, StatusChangeNotAllowed, ProofRequired, CriteriaEditNotAllowed]

const reach = (branch: z.core.$ZodIssue[]): number => Math.min(...branch.map((inner) => inner.path.length))

const closestBranch = (issue: z.core.$ZodIssueInvalidUnion): z.core.$ZodIssue[] =>
  issue.errors.reduce((best, branch) => (reach(branch) > reach(best) ? branch : best))

const problemsOf = (error: z.ZodError): Problem[] =>
  error.issues.flatMap((issue) =>
    issue.code === 'invalid_union' && issue.errors.length > 0
      ? closestBranch(issue).map((inner) => ({
          path: [...issue.path, ...inner.path].join('.'),
          message: inner.message,
        }))
      : [{ path: issue.path.join('.'), message: issue.message }],
  )

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

const write = async (
  tx: Conn,
  run: Run,
  module: LifecycleModule,
  data: unknown,
  deps: SubmitDeps,
): Promise<Written> => {
  const stored = await readRecord(tx, run.recordId)
  const config = await deps.configFor(run.recordId)
  if (module.gated) {
    const facts = await loadGateFacts(tx, stored, run, config)
    const outcome = gate({ result: verifyResultSchema.parse(data), record: stored.record, facts })
    if (!outcome.accepted) return { problems: outcome.refusals }
  }
  try {
    const state = fold(await readEvents(tx, run.recordId), foldOptions(config))
    const applied = module.apply(stored.record, data, run, { config, state })
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
  const state = fold(await readEvents(tx, current.recordId), foldOptions(await deps.configFor(current.recordId)))
  if (state.closed !== null || state.stage === 'done') {
    throw new RecordClosed(`Record ${current.recordId} is closed: stop working on run ${current.id}.`)
  }
  const module = deps.modules[current.stage]
  if (!module) throw new ModuleMissing(`No module is registered for stage ${current.stage}: register one.`)
  const parsed = module.resultSchema.safeParse(rawResult)
  if (!parsed.success) return refuse(tx, current, problemsOf(parsed.error), deps.now)
  const written = await write(tx, current, module, parsed.data, deps)
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

export const failRun = async (runId: number, token: string, reason: string, deps: AdvanceDeps): Promise<void> => {
  const run = await readRun(deps.payload, runId)
  const text = reason.trim().slice(0, 300) || 'the run failed'
  await inLockedRecord(deps.payload, run.recordId, async (tx) => {
    const current = await authorize(tx, runId, token)
    await finishRun(tx, runId, { status: 'failed', error: text, now: deps.now })
    await appendEvent(tx, current.recordId, {
      type: 'run.failed',
      data: { stage: current.stage, runId: String(runId), reason: text },
      actor: 'factory',
    })
  })
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
