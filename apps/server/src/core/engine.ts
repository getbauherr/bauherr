import type { Payload } from 'payload'
import { runEffects, type ForgePort } from './effects'
import type { AppEvent, Stage } from './events'
import { fingerprint, fold, foldOptions, next, type Config, type State, type Step } from './lifecycle'
import type { RecordSource } from './record/schema'
import {
  appendEvent,
  readEvents,
  readRecord,
  setCard,
  setParked,
  setProjection,
  type StoredCard,
  type StoredRecord,
  type WaitingOn,
} from './record/store'
import { enqueue, releaseLive } from './run/leases'

export const MAX_ADVANCE_STEPS = 10

export type MergeTarget = { recordId: number; source: RecordSource; pr: number; headSha: string }
export type MergeFn = (target: MergeTarget) => Promise<{ sha: string }>
export type StartVerdict = { ok: true } | { ok: false; reason: string }
export type MayStartFn = (stored: StoredRecord, stage: Stage) => Promise<StartVerdict>
export type AdvanceDeps = {
  payload: Payload
  configFor: (recordId: number) => Promise<Config>
  now: Date
  merge: MergeFn
  mayStart?: MayStartFn
  forge?: ForgePort
}

type Ctx = { deps: AdvanceDeps; stored: StoredRecord; state: State; seq: number }
type Raised = Omit<StoredCard, 'seq'>
type Outcome = 'repeat' | 'stop'

const WAITING: Record<Extract<Step, { kind: 'wait' }>['on'], WaitingOn> = {
  reporter: 'reporter',
  run: 'agents',
  checks: 'agents',
  deploy: 'agents',
  owner: 'owner',
  author: 'author',
}

const HELD: Raised = { card: 'question', reason: 'production-held', options: ['approve-production'] }

const append = (ctx: Ctx, event: AppEvent) =>
  appendEvent(ctx.deps.payload, ctx.stored.id, { ...event, actor: 'factory' })

const raised = (ctx: Ctx, card: Raised | null, seq: number): StoredCard | null => {
  if (card === null) return null
  const held = ctx.stored.card
  const same = held !== null && JSON.stringify({ ...held, seq: 0 }) === JSON.stringify({ ...card, seq: 0 })
  return { ...card, seq: same ? held.seq : seq }
}

const project = async (ctx: Ctx, waitingOn: WaitingOn, card: Raised | null, stage: Stage = ctx.state.stage) => {
  await setProjection(ctx.deps.payload, ctx.stored.id, { stage, waitingOn })
  if (stage !== ctx.stored.stage && (ctx.state.brief === 'approved' || ctx.state.returned)) {
    await runEffects(ctx.deps, ctx.stored.id, [{ kind: 'status' }])
  }
  await setCard(ctx.deps.payload, ctx.stored.id, raised(ctx, card, ctx.seq))
}

const runStep = async (step: Extract<Step, { kind: 'run' }>, ctx: Ctx): Promise<Outcome> => {
  const print = fingerprint({ stage: step.stage, version: ctx.stored.version, note: ctx.state.note })
  const verdict = (await ctx.deps.mayStart?.(ctx.stored, step.stage)) ?? { ok: true }
  if (!verdict.ok) {
    await setParked(ctx.deps.payload, ctx.stored.id, verdict.reason)
    await project(ctx, 'nobody', null, step.stage)
    return 'stop'
  }
  if (ctx.stored.parked !== null) await setParked(ctx.deps.payload, ctx.stored.id, null)
  const input = { stage: step.stage, role: step.role, fingerprint: print }
  const { run, created } = await enqueue(ctx.deps.payload, ctx.stored.id, input)
  if (created) {
    await append(ctx, { type: 'run.started', data: { stage: step.stage, runId: String(run.id), fingerprint: print } })
  }
  await project(ctx, 'agents', null, step.stage)
  return 'stop'
}

const cardStep = async (step: Extract<Step, { kind: 'card' }>, ctx: Ctx): Promise<Outcome> => {
  const { card, reason, options } = step
  if (card === 'question') {
    await append(ctx, { type: 'question.asked', data: { reason, options } })
    ctx.seq++
  }
  await project(ctx, 'owner', { card, reason, options })
  return 'stop'
}

const attemptMerge = async (ctx: Ctx): Promise<AppEvent> => {
  const pr = ctx.state.patch?.pr
  const headSha = ctx.state.verdict?.headSha
  const failed = (reason: string): AppEvent => ({ type: 'run.failed', data: { stage: 'ship', runId: 'merge', reason } })
  if (pr === undefined || headSha === undefined) return failed('no verified patch to merge')
  try {
    const { sha } = await ctx.deps.merge({ recordId: ctx.stored.id, source: ctx.stored.record.source, pr, headSha })
    return { type: 'ship.merged', data: { sha } }
  } catch (error) {
    return failed(error instanceof Error && error.message.trim() !== '' ? error.message : 'merge failed')
  }
}

const waitStep = async (step: Extract<Step, { kind: 'wait' }>, ctx: Ctx): Promise<Outcome> => {
  const owner = step.on === 'owner'
  await project(ctx, WAITING[step.on], owner ? (ctx.state.card ?? HELD) : null)
  return 'stop'
}

const releaseLiveRuns = async (ctx: Ctx): Promise<void> => {
  const ended = await releaseLive(ctx.deps.payload, ctx.stored.id, ctx.deps.now)
  for (const run of ended) {
    if (ctx.state.run?.runId !== String(run.id)) continue
    await append(ctx, { type: 'run.released', data: { stage: run.stage, runId: String(run.id) } })
  }
}

const handle = async (step: Step, ctx: Ctx): Promise<Outcome> => {
  switch (step.kind) {
    case 'run':
      return runStep(step, ctx)
    case 'card':
      return cardStep(step, ctx)
    case 'emit':
      await append(ctx, step.event)
      return 'repeat'
    case 'effect':
      await append(ctx, await attemptMerge(ctx))
      return 'repeat'
    case 'wait':
      return waitStep(step, ctx)
    case 'done':
      await releaseLiveRuns(ctx)
      await project(ctx, 'nobody', null)
      return 'stop'
  }
}

export const advance = async (recordId: number, deps: AdvanceDeps): Promise<void> => {
  const config = await deps.configFor(recordId)
  for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
    const stored = await readRecord(deps.payload, recordId)
    const events = await readEvents(deps.payload, recordId)
    const state = fold(events, foldOptions(config))
    const ctx = { deps, stored, state, seq: events.length }
    const outcome = await handle(next(stored.record, state, config), ctx)
    if (outcome === 'stop') return
  }
}
