import { cloneRepo } from '@bauherr/runner'
import { z } from 'zod'
import { fold } from '../../core/fold'
import { foldOptions } from '../../core/lifecycle'
import { LeaseLost, ModuleMissing } from '../../core/run/errors'
import { heartbeat, type Claimed } from '../../core/run/leases'
import { contextPack, type ContextPack } from '../../core/run/pack'
import { addCost, markRefused, readRun } from '../../core/run/store'
import { readEvents, readRecord } from '../../core/record/store'
import type { Problem } from '../../core/module'
import { failRun, releaseRun, submit, type SubmitResult } from '../../core/submit'
import { planFor, type Checkout, type Plan } from './plan'
import { keepAlive } from './heartbeat'
import type { AgentOutcome, Ended, RunnerDeps } from './types'
import { recordProofs, withProofIds } from './proofs'
import { FIX_PROMPT, PROMPT, readResult, writeContext, writeProblems } from './workdir'

const READ_ONLY = new Set(['intake', 'brief', 'done'])

type Working = { claimed: Claimed; deps: RunnerDeps; checkout: Checkout; workspace: number; model: string }

const note = (working: Working, step: string) => {
  const { run, token } = working.claimed
  const { engine } = working.deps
  return heartbeat(engine().payload, run.id, token, { now: engine().now, step })
}

const turn = async (working: Working, prompt: string): Promise<AgentOutcome> => {
  const { run } = working.claimed
  await note(working, prompt === PROMPT ? 'the agent started' : 'the agent corrects its result')
  const stop = keepAlive(working.deps, working.claimed)
  const outcome = await working.deps
    .agent({
      runId: run.id,
      stage: run.stage,
      workspace: working.workspace,
      model: working.model,
      cwd: working.checkout.dir,
      home: working.checkout.home,
      prompt,
      readOnly: READ_ONLY.has(run.stage),
    })
    .finally(stop)
  if (outcome.ok) await addCost(working.deps.engine().payload, run.id, outcome.costUsd)
  return outcome
}

const fail = async (claimed: Claimed, deps: RunnerDeps, reason: string): Promise<Ended> => {
  await failRun(claimed.run.id, claimed.token, reason, deps.engine())
  return 'failed'
}

const result = async (working: Working, facts: Record<string, unknown>) => {
  const raw = await readResult(working.checkout.dir)
  return raw === null ? null : { ...raw, ...facts }
}

const MISSING = 'the agent wrote no .bauherr/result.json'

const headOf = z.object({ headSha: z.string() })

const withProofs = async (working: Working, raw: Record<string, unknown>): Promise<Prepared> => {
  const { claimed, deps } = working
  const { run } = claimed
  if (run.stage !== 'verify' || run.role !== 'verifier') return { result: raw }
  const { payload } = deps.engine()
  const stored = await readRecord(payload, run.recordId)
  const recorded = await recordProofs({
    checkout: working.checkout,
    payload,
    workspace: working.workspace,
    recordId: run.recordId,
    criteria: stored.record.criteria.map((criterion) => criterion.id),
    headSha: headOf.parse(raw).headSha,
  })
  return 'problems' in recorded ? recorded : { result: withProofIds(raw, recorded.refs) }
}

type Prepared = { result: Record<string, unknown> } | { problems: Problem[] } | { reason: string }

const prepared = async (working: Working, facts: Record<string, unknown>): Promise<Prepared> => {
  const raw = await result(working, facts)
  return raw === null ? { reason: MISSING } : withProofs(working, raw)
}

const textOf = (problems: Problem[]): string => problems.map((p) => `${p.path}: ${p.message}`).join('; ')

const conclude = async (working: Working, facts: Record<string, unknown>): Promise<Ended> => {
  const { claimed, deps } = working
  const first = await prepared(working, facts)
  if ('reason' in first) return fail(claimed, deps, first.reason)
  let sent: SubmitResult
  if ('problems' in first) {
    await markRefused(deps.engine().payload, claimed.run.id)
    sent = { status: 'retry', problems: first.problems }
  } else {
    sent = await submit(claimed.run.id, claimed.token, first.result, deps.engine())
  }
  if (sent.status !== 'retry') return sent.status === 'accepted' ? 'accepted' : 'failed'
  await writeProblems(working.checkout.dir, sent.problems)
  const fix = await turn(working, FIX_PROMPT)
  if (!fix.ok) return fail(claimed, deps, fix.reason)
  const second = await prepared(working, facts)
  if ('reason' in second) return fail(claimed, deps, second.reason)
  if ('problems' in second) return fail(claimed, deps, textOf(second.problems))
  const again = await submit(claimed.run.id, claimed.token, second.result, deps.engine())
  return again.status === 'accepted' ? 'accepted' : 'failed'
}

type Setup = { plan: Plan; workspace: number; pack: ContextPack }

const prepare = async (claimed: Claimed, deps: RunnerDeps): Promise<Setup> => {
  const { run } = claimed
  const pack = await contextPack(deps.engine(), run)
  const stored = await readRecord(deps.engine().payload, run.recordId)
  const config = await deps.engine().configFor(run.recordId)
  const state = fold(await readEvents(deps.engine().payload, run.recordId), foldOptions(config))
  const access = await deps.access(run.recordId)
  const plan = await planFor({ run, stored, state, access, deps })
  return { plan, workspace: stored.workspace, pack }
}

const run = async (claimed: Claimed, deps: RunnerDeps, checkout: Checkout, setup: Setup): Promise<Ended> => {
  const { plan, workspace, pack } = setup
  await writeContext(checkout.dir, pack)
  const model = await deps.model(workspace, claimed.run.role)
  const working = { claimed, deps, checkout, workspace, model }
  const outcome = await turn(working, PROMPT)
  if (!outcome.ok) return fail(claimed, deps, outcome.reason)
  const sealed = await plan.seal(checkout)
  return sealed.ok ? conclude(working, sealed.facts) : fail(claimed, deps, sealed.reason)
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const workRun = async (claimed: Claimed, deps: RunnerDeps): Promise<Ended> => {
  let checkout: Checkout | undefined
  try {
    const setup = await prepare(claimed, deps)
    checkout = await cloneRepo(setup.plan.clone)
    return await run(claimed, deps, checkout, setup)
  } catch (error) {
    if (error instanceof ModuleMissing) {
      await releaseRun(claimed.run.id, claimed.token, deps.engine())
      return 'released'
    }
    if (error instanceof LeaseLost) return 'expired'
    const current = await readRun(deps.engine().payload, claimed.run.id)
    if (current.status !== 'claimed') throw error
    return fail(claimed, deps, messageOf(error))
  } finally {
    await checkout?.cleanup()
  }
}
