import type { Payload } from 'payload'
import { MergePending } from './forge/merge-pending'
import { stackBaseOf, stackedOnRecord } from './forge/stack'
import { mirrorItem, runEffects, type ForgePort } from './effects'
import type { AppEvent, Stage } from './events'
import { fingerprint, fold, foldOptions, next, type Config, type State, type Step } from './lifecycle'
import { createKept } from './relations/keep'
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
import { blockedByRecord, blockersOf } from './relations/blockers'
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
  nobody: 'nobody',
}

const holding = (ctx: Ctx, on: WaitingOn): WaitingOn => (ctx.state.stage === 'done' ? 'nobody' : on)

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

const bringUp = async (ctx: Ctx, retarget: boolean): Promise<'ready' | 'restart'> => {
  const { forge } = ctx.deps
  const patch = ctx.state.patch
  if (forge === undefined || patch === null || ctx.state.adopted) return 'ready'
  const itemId = await mirrorItem(ctx.deps.payload, ctx.stored, 'pr', patch.pr)
  if (itemId === null) return 'ready'
  const update = await forge.updatePullRequestBranch({ recordId: ctx.stored.id, itemId }, retarget).catch(() => null)
  if (update === null || update.kind === 'current') return 'ready'
  if (update.kind === 'updated') {
    await append(ctx, { type: 'pull.updated', data: { patchId: patch.id, headSha: update.headSha } })
    return 'restart'
  }
  await append(ctx, { type: 'pull.conflicted', data: { patchId: patch.id, base: update.base } })
  await runEffects(ctx.deps, ctx.stored.id, [{ kind: 'status' }])
  return 'restart'
}

const runStep = async (step: Extract<Step, { kind: 'run' }>, ctx: Ctx): Promise<Outcome> => {
  const print = fingerprint({ stage: step.stage, version: ctx.stored.version, note: ctx.state.note })
  const verdict = (await ctx.deps.mayStart?.(ctx.stored, step.stage)) ?? { ok: true }
  if (!verdict.ok) {
    await setParked(ctx.deps.payload, ctx.stored.id, verdict.reason)
    await project(ctx, 'nobody', null, step.stage)
    return 'stop'
  }
  if (step.stage === 'verify' && step.role === 'reviewer' && (await bringUp(ctx, false)) === 'restart') {
    return 'repeat'
  }
  if (ctx.stored.parked !== null) await setParked(ctx.deps.payload, ctx.stored.id, null)
  const input = { stage: step.stage, role: step.role, fingerprint: print }
  const { run, created } = await enqueue(ctx.deps.payload, ctx.stored.id, input)
  if (created) {
    await append(ctx, { type: 'run.started', data: { stage: step.stage, runId: String(run.id), fingerprint: print } })
  }
  await project(ctx, holding(ctx, 'agents'), null, step.stage)
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

const attemptMerge = async (ctx: Ctx): Promise<AppEvent | MergePending> => {
  const pr = ctx.state.patch?.pr
  const headSha = ctx.state.verdict?.headSha
  const failed = (reason: string): AppEvent => ({ type: 'run.failed', data: { stage: 'ship', runId: 'merge', reason } })
  if (pr === undefined || headSha === undefined) return failed('no verified patch to merge')
  try {
    const { sha } = await ctx.deps.merge({ recordId: ctx.stored.id, source: ctx.stored.record.source, pr, headSha })
    return { type: 'ship.merged', data: { sha } }
  } catch (error) {
    if (error instanceof MergePending) return error
    return failed(error instanceof Error && error.message.trim() !== '' ? error.message : 'merge failed')
  }
}

const mergeStep = async (ctx: Ctx): Promise<Outcome> => {
  const pr = ctx.state.patch?.pr
  const base = pr === undefined ? null : await stackBaseOf(ctx.deps.payload, ctx.stored, pr)
  if (base !== null && base.open) {
    await setParked(ctx.deps.payload, ctx.stored.id, `Waiting for #${base.number} to merge first`)
    await project(ctx, 'nobody', null)
    return 'stop'
  }
  if (base !== null && (await bringUp(ctx, true)) === 'restart') return 'repeat'
  const result = await attemptMerge(ctx)
  if (result instanceof MergePending) {
    await setParked(ctx.deps.payload, ctx.stored.id, `Merge will be retried: ${result.message}`)
    await project(ctx, 'agents', null)
    return 'stop'
  }
  if (ctx.stored.parked !== null) await setParked(ctx.deps.payload, ctx.stored.id, null)
  await append(ctx, result)
  return 'repeat'
}

const waitStep = async (step: Extract<Step, { kind: 'wait' }>, ctx: Ctx): Promise<Outcome> => {
  const owner = step.on === 'owner'
  await project(ctx, holding(ctx, WAITING[step.on]), owner ? ctx.state.card : null)
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
      if (step.event.type === 'brief.approved') await createKept(ctx.deps, ctx.stored.id, ctx.stored.record.relations)
      return 'repeat'
    case 'effect':
      return mergeStep(ctx)
    case 'wait':
      return waitStep(step, ctx)
    case 'done':
      await releaseLiveRuns(ctx)
      await project(ctx, 'nobody', null)
      return 'stop'
  }
}

const advanceOne = async (recordId: number, deps: AdvanceDeps): Promise<boolean> => {
  const config = await deps.configFor(recordId)
  for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
    const stored = await readRecord(deps.payload, recordId)
    const events = await readEvents(deps.payload, recordId)
    const state = fold(events, foldOptions(config))
    const ctx = { deps, stored, state, seq: events.length }
    const blockers = await blockersOf(deps.payload, stored)
    const outcome = await handle(next(stored.record, state, config, blockers), ctx)
    if (outcome === 'stop') return state.merged || state.closed !== null
  }
  return false
}

export const advance = async (recordId: number, deps: AdvanceDeps): Promise<void> => {
  if (!(await advanceOne(recordId, deps))) return
  const stored = await readRecord(deps.payload, recordId)
  const waiting = new Set([
    ...(await blockedByRecord(deps.payload, stored)),
    ...(await stackedOnRecord(deps.payload, stored)),
  ])
  for (const id of waiting) await advance(id, deps)
}
