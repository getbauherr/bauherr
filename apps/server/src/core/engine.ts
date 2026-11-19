import type { Payload } from 'payload'
import type { AppEvent, Stage } from './events'
import { fingerprint, fold, next, type Config, type State, type Step } from './lifecycle'
import type { RecordSource } from './record/schema'
import {
  appendEvent,
  readEvents,
  readRecord,
  setCard,
  setProjection,
  type StoredCard,
  type StoredRecord,
  type WaitingOn,
} from './record/store'
import { enqueue } from './run/leases'

export const MAX_ADVANCE_STEPS = 10

export type MergeTarget = { recordId: number; source: RecordSource; pr: number }
export type MergeFn = (target: MergeTarget) => Promise<{ sha: string }>
export type AdvanceDeps = {
  payload: Payload
  configFor: (recordId: number) => Promise<Config>
  now: Date
  merge: MergeFn
}

type Ctx = { deps: AdvanceDeps; stored: StoredRecord; state: State }
type Outcome = 'repeat' | 'stop'

const WAITING: Record<Extract<Step, { kind: 'wait' }>['on'], WaitingOn> = {
  reporter: 'reporter',
  run: 'agents',
  checks: 'agents',
  deploy: 'agents',
  owner: 'owner',
}

const append = (ctx: Ctx, event: AppEvent) =>
  appendEvent(ctx.deps.payload, ctx.stored.id, { ...event, actor: 'factory' })

const project = async (ctx: Ctx, waitingOn: WaitingOn, card: StoredCard | null, stage: Stage = ctx.state.stage) => {
  await setProjection(ctx.deps.payload, ctx.stored.id, { stage, waitingOn })
  await setCard(ctx.deps.payload, ctx.stored.id, card)
}

const runStep = async (step: Extract<Step, { kind: 'run' }>, ctx: Ctx): Promise<Outcome> => {
  const print = fingerprint({ stage: step.stage, version: ctx.stored.version, note: ctx.state.note })
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
  if (card === 'question') await append(ctx, { type: 'question.asked', data: { reason, options } })
  await project(ctx, 'owner', { card, reason, options })
  return 'stop'
}

const attemptMerge = async (ctx: Ctx): Promise<AppEvent> => {
  const pr = ctx.state.patch?.pr
  const failed = (reason: string): AppEvent => ({ type: 'run.failed', data: { stage: 'ship', runId: 'merge', reason } })
  if (pr === undefined) return failed('no patch to merge')
  try {
    const { sha } = await ctx.deps.merge({ recordId: ctx.stored.id, source: ctx.stored.record.source, pr })
    return { type: 'ship.merged', data: { sha } }
  } catch (error) {
    return failed(error instanceof Error && error.message.trim() !== '' ? error.message : 'merge failed')
  }
}

const waitStep = async (step: Extract<Step, { kind: 'wait' }>, ctx: Ctx): Promise<Outcome> => {
  await project(ctx, WAITING[step.on], step.on === 'owner' ? ctx.state.card : null)
  return 'stop'
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
      await project(ctx, 'nobody', null)
      return 'stop'
  }
}

export const advance = async (recordId: number, deps: AdvanceDeps): Promise<void> => {
  const config = await deps.configFor(recordId)
  for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
    const stored = await readRecord(deps.payload, recordId)
    const state = fold(await readEvents(deps.payload, recordId), { productionGate: config.productionGate })
    const outcome = await handle(next(stored.record, state, config), { deps, stored, state })
    if (outcome === 'stop') return
  }
}
