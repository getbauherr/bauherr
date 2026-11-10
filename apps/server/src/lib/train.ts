import { sql } from '@payloadcms/db-postgres'
import { MergePendingError } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { CHECKS_WAIT_MS, MAX_MERGE_FAILURES, escalate, moveReview, returnConflictToBuild, returnDroppedToBuild, reviewedShaOf } from './actions'
import { executionOrder, type FrontierTicket } from './frontier'
import { TRAIN_BRANCH, trainConcurrency } from './merge-mode'
import { queueDistill } from './skill-distill'
import { failedCheck, forgeOf, id, latestChecks, prOf } from './release'
import { DEFAULT, nameOf } from './workflow'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export type TrainMember = { ticket: number | string; pr: number; headSha: string }
/** `probe` is the prefix length under test while bisecting (null when the whole train is); `results` the verdict per tested prefix length; `tip` the train branch's commit under test. */
export type TrainState = { baseSha: string; members: TrainMember[]; phase: 'testing' | 'bisect'; probe: number | null; results: Record<string, { ok: boolean; link?: string }>; tip: string; since: string }

/** Smallest prefix length of a train of `k` PRs that fails, given that the whole train fails; binary search, `passes(m)` runs the checks of the first `m` PRs. */
export const bisectFirstFailure = async (k: number, passes: (m: number) => Promise<boolean>): Promise<number> => {
  let [lo, hi] = [0, k]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (await passes(mid)) lo = mid
    else hi = mid
  }
  return hi
}

/** Thrown by the replayed bisect when it needs a prefix nobody has tested yet. */
class NeedsProbe extends Error {
  constructor(readonly length: number) {
    super(`prefix ${length} untested`)
  }
}

/** Compare-and-set of a Product's `trainState` (jsonb equality), like `cas` in release.ts: true when this call changed it. */
const casTrain = async (payload: Payload, product: number | string, next: TrainState | null, prev: TrainState | null): Promise<boolean> =>
  (
    await payload.db.drizzle.execute(
      sql`UPDATE "products" SET "train_state" = ${next ? JSON.stringify(next) : null}::jsonb, "updated_at" = now() WHERE "id" = ${product} AND "train_state" IS NOT DISTINCT FROM ${prev ? JSON.stringify(prev) : null}::jsonb RETURNING "id"`,
    )
  ).rows.length > 0

type Ctx = Awaited<ReturnType<typeof forgeOf>> & { product: Doc; base: string }

/** Verdict of the train tip: the Product's `deployChecks` (all when empty); none registered yet is pending. `link` is the failed check's run, else the train branch's runs. */
const tipChecks = async (c: Ctx, tip: string): Promise<{ state: 'green' | 'pending' | 'red'; link?: string }> => {
  const names = String(c.product.deployChecks ?? '').split(',').map((n) => n.trim()).filter(Boolean)
  const latest = latestChecks(await c.backend.forge.listChecks(c.repo, tip))
  const picked = names.length ? names.map((n) => latest.find((x) => x.name === n)) : latest
  const failed = picked.find(failedCheck)
  if (failed) return { state: 'red', link: failed.url ?? (c.kind === 'gitlab' ? `${c.web}/${c.repo}/-/pipelines?ref=${encodeURIComponent(TRAIN_BRANCH)}` : `${c.web}/${c.repo}/actions?query=branch%3A${encodeURIComponent(TRAIN_BRANCH)}`) }
  return picked.length && picked.every((x) => x?.status === 'completed') ? { state: 'green' } : { state: 'pending' }
}

const mrOf = async (c: Ctx, m: TrainMember) => ({ backend: c.backend, repo: c.repo, tickets: c.tickets, pr: await c.backend.forge.getPullRequest(c.repo, m.pr) })

/** Resets the train branch to the base and merges the first `n` members; the tip, or null when one no longer merges cleanly. */
const buildPrefix = async (c: Ctx, state: TrainState, n: number): Promise<string | null> => {
  await c.backend.forge.resetBranch(c.repo, TRAIN_BRANCH, state.baseSha)
  let tip = state.baseSha
  for (const m of state.members.slice(0, n)) {
    const merged = await c.backend.forge.mergeIntoBranch(c.repo, TRAIN_BRANCH, m.headSha)
    if ('conflict' in merged) return null
    tip = merged.sha
  }
  return tip
}

/** Squash-merges the members in order onto main, each pinned to its tested head. A failure stops here: the rest stays queued and re-trains. Counts like a failed direct merge. */
const mergeMembers = async (payload: Payload, c: Ctx, members: TrainMember[]): Promise<void> => {
  for (const m of members) {
    try {
      await c.backend.forge.mergePullRequest(c.repo, m.pr, { method: 'squash', deleteBranch: true, expectSha: m.headSha })
      await queueDistill(payload, { id: m.ticket })
    } catch (e) {
      if (e instanceof MergePendingError) return
      payload.logger.error({ err: e, ticket: m.ticket }, 'merging a train member failed')
      const failures = Number((await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "merge_failures" = COALESCE("merge_failures", 0) + 1 WHERE "id" = ${m.ticket} RETURNING "merge_failures"`)).rows[0]!.merge_failures)
      if (failures >= MAX_MERGE_FAILURES) await escalate(payload, (await payload.findByID({ collection: 'tickets', id: m.ticket, ...o })) as Doc, `merging the MR failed ${failures} times in a row: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
  }
}

/** One step of a running train. `done` when the train is over (merged, failed or invalidated) and a new one may start, `wait` while checks run. */
const advance = async (payload: Payload, c: Ctx, state: TrainState, at: number): Promise<'wait' | 'done'> => {
  const end = async () => (await casTrain(payload, c.product.id, null, state), 'done' as const)
  const review = nameOf(DEFAULT(), 'review')
  for (const m of state.members) {
    const [t, pr] = await Promise.all([payload.findByID({ collection: 'tickets', id: m.ticket, ...o }) as Promise<Doc>, c.backend.forge.getPullRequest(c.repo, m.pr)])
    if (t.state !== 'open' || t.stage !== review || t.reviewState !== 'queued' || pr.state !== 'open' || pr.headSha !== m.headSha) return end()
  }
  if ((await c.backend.forge.getBranch(c.repo, c.base))?.sha !== state.baseSha) return end()
  const k = state.members.length
  const tested = state.probe ?? k
  const verdict = await tipChecks(c, state.tip)
  if (verdict.state === 'pending') {
    if (at - Date.parse(state.since) <= CHECKS_WAIT_MS) return 'wait'
    if (!(await casTrain(payload, c.product.id, null, state))) return 'wait'
    for (const m of state.members) await escalate(payload, (await payload.findByID({ collection: 'tickets', id: m.ticket, ...o })) as Doc, `the checks on ${TRAIN_BRANCH} (${state.tip.slice(0, 7)}) did not finish within 2 hours; make sure CI runs on that branch.`)
    return 'done'
  }
  const results: TrainState['results'] = { ...state.results, [tested]: { ok: verdict.state === 'green', ...(verdict.link && { link: verdict.link }) } }
  if (verdict.state === 'green' && tested === k) {
    if (!(await casTrain(payload, c.product.id, null, state))) return 'wait'
    await mergeMembers(payload, c, state.members)
    return 'done'
  }
  let first: number
  try {
    first = await bisectFirstFailure(k, async (n) => {
      if (!results[n]) throw new NeedsProbe(n)
      return results[n]!.ok
    })
  } catch (e) {
    if (!(e instanceof NeedsProbe)) throw e
    const tip = await buildPrefix(c, state, e.length)
    if (tip === null) return end()
    await casTrain(payload, c.product.id, { ...state, phase: 'bisect', probe: e.length, results, tip, since: new Date(at).toISOString() }, state)
    return 'wait'
  }
  if (!(await casTrain(payload, c.product.id, null, state))) return 'wait'
  await mergeMembers(payload, c, state.members.slice(0, first - 1))
  const failing = state.members[first - 1]!
  const t = (await payload.findByID({ collection: 'tickets', id: failing.ticket, ...o })) as Doc
  await returnDroppedToBuild(payload, t, await mrOf(c, failing), results[first]?.link, 'factory train')
  return 'done'
}

/** Builds a train from the queued Tickets: by Board order, at most `trainConcurrency`, each merged into `bauherr/train` on top of the base; one that conflicts goes back to Build. */
const start = async (payload: Payload, c: Ctx, at: number): Promise<void> => {
  const queued = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: c.product.id } }, { state: { equals: 'open' } }, { stage: { equals: nameOf(DEFAULT(), 'review') } }, { reviewState: { equals: 'queued' } }] }, limit: 200, pagination: false, ...o })).docs as Doc[]
  queued.sort((a, b) => executionOrder(a as FrontierTicket, b as FrontierTicket))
  const limit = trainConcurrency((await payload.findByID({ collection: 'workspaces', id: id(c.product.workspace), ...o })) as Doc)
  const base = (await c.backend.forge.getBranch(c.repo, c.base))?.sha
  if (!base) return
  const state: TrainState = { baseSha: base, members: [], phase: 'testing', probe: null, results: {}, tip: base, since: new Date(at).toISOString() }
  let reset = false
  for (const t of queued) {
    if (state.members.length >= limit) break
    const mr = await prOf(payload, t)
    const reviewed = await reviewedShaOf(payload, t)
    if (mr?.pr.state !== 'open' || mr.pr.headSha !== reviewed) continue
    if (!reset) await c.backend.forge.resetBranch(c.repo, TRAIN_BRANCH, base)
    reset = true
    const merged = await c.backend.forge.mergeIntoBranch(c.repo, TRAIN_BRANCH, mr.pr.headSha)
    if ('conflict' in merged) {
      if (await moveReview(payload, t.id, 'waiting_checks', 'queued')) await returnConflictToBuild(payload, t, mr, reviewed)
      continue
    }
    state.members.push({ ticket: t.id, pr: mr.pr.number, headSha: mr.pr.headSha })
    state.tip = merged.sha
  }
  if (state.members.length) await casTrain(payload, c.product.id, state, null)
}

/**
 * Per minute, for every `train` Product (Tickets are `queued` by the merge gate): advances its running train by one step, or starts one from the queued Tickets.
 * One train per Product at a time; every state write is a compare-and-set, a failing Product does not stop the others.
 */
export const runTrains = async (payload: Payload, at = Date.now()): Promise<void> => {
  const products = (await payload.find({ collection: 'products', where: { mergeMode: { equals: 'train' } }, pagination: false, ...o })).docs as Doc[]
  for (const product of products) {
    try {
      const forge = await forgeOf(payload, product.id)
      const c: Ctx = { ...forge, product, base: (await forge.backend.forge.getRepository(forge.repo)).defaultBranch }
      if (product.trainState && (await advance(payload, c, product.trainState as TrainState, at)) === 'wait') continue
      await start(payload, c, at)
    } catch (e) {
      payload.logger.error({ err: e, product: product.id }, 'run-trains failed for product')
    }
  }
}
