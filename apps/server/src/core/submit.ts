import type { z } from 'zod'
import { inLockedRecord, type Conn } from './conn'
import { runEffects } from './effects'
import type { Stage } from './events'
import { advance, type AdvanceDeps } from './engine'
import { fold } from './fold'
import { gate, reviewGate, type GateFacts, type GateOutcome } from './gate'
import { loadGateFacts } from './gate-facts'
import { foldOptions, type Role } from './lifecycle'
import { moduleKey, type Effect, type LifecycleModule, type Modules, type Problem } from './module'
import {
  CriteriaEditNotAllowed,
  FieldNotWritable,
  InvalidPatch,
  ProofRequired,
  StatusChangeNotAllowed,
} from './record/errors'
import type { TicketRecord } from './record/schema'
import { appendEvent, patchRecord, readEvents, readRecord } from './record/store'
import { reviewResultSchema } from './review-result'
import { verifyResultSchema } from './verify-result'
import { ModuleMissing, RecordClosed } from './run/errors'
import { authorize, EXPIRY_REASON, expire, release, type Expired } from './run/leases'
import type { Run, Tier } from './run/schema'
import { finishRun, markRefused, readRun } from './run/store'

export type TierLoader = (role: Role) => Promise<Tier>
export type SkillLoader = (stage: Stage, role: Role) => Promise<string | null>
export type SubmitDeps = AdvanceDeps & { modules: Modules; skills?: SkillLoader; tiers?: TierLoader }
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

const expiredEvent = (conn: Conn, run: { runId: number; recordId: number; stage: Run['stage'] }) =>
  appendEvent(conn, run.recordId, {
    type: 'run.expired',
    data: { stage: run.stage, runId: String(run.runId), reason: EXPIRY_REASON },
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

const gated = (module: LifecycleModule, data: unknown, record: TicketRecord, facts: GateFacts): GateOutcome =>
  module.role === 'reviewer'
    ? reviewGate({ result: reviewResultSchema.parse(data), facts })
    : gate({ result: verifyResultSchema.parse(data), record, facts })

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
  const missing = (await module.check?.(tx, run, data)) ?? []
  if (missing.length > 0) return { problems: missing }
  if (module.gated) {
    const outcome = gated(module, data, stored.record, await loadGateFacts(tx, stored, run, config))
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
  const module = deps.modules[moduleKey(current.stage, current.role)]
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
    await expiredEvent(deps.payload, run)
  }
  for (const recordId of new Set(expired.map((run) => run.recordId))) await advance(recordId, deps)
  return expired
}
