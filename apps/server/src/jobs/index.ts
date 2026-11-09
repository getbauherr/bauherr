import { sql } from '@payloadcms/db-postgres'
import { Cron } from 'croner'
import type { Payload, PayloadRequest, TaskConfig } from 'payload'
import { APPROVED_PLAN, setStage, stageLabel, stageOf, type TicketSource } from '@bauherr/adapters'
import { runStage as exec } from '@bauherr/runner'
import { backendFor } from '../lib/adapters'
import { connectionInput } from '../lib/connection'
import { buildRunCtx } from '../lib/run-ctx'
import { REVIEW_CAP_REASON, submitInvestigation, type InvestigationInput } from '../lib/investigation'
import { mergeMainIntoMr } from '../lib/merge-main'
import { distillSkill } from '../lib/skill-distill'
import { gateOn, modeFor, packed } from '../lib/mode'
import { pruneCommentMedia } from '../lib/intake/media'
import { gatewayDbEnabled, pruneRequestLogs, queueReconcile, reconcileRun, retentionDays } from '../lib/reconcile'
import { runTrains } from '../lib/train'
import { advancePlan, closeFinishedParents, holdsRefine, concludeReview, lastRankAfter, normalizeReview, normalizeTriage, rebindReview, restartParkedReviews, resumeReviews, spawnSubTickets, submitTriage, upsertTicket, watchChecks, watchQueued, watchReviews, checksGate, parkForChecks } from '../lib/actions'
import { EXPEDITE_LABEL, NEEDS_REFINEMENT } from '../lib/needs-you'
import { laneOn, noteIgnored, startExpedites } from '../lib/expedite'
import { logins, syncGates } from '../lib/gates'
import { isForward, moveStage } from '../lib/stage-move'
import { holdOverlap } from '../lib/overlap'
import { enterStage, pullWaiting } from '../lib/wip'
import { GATE_LABELS, REJECTED_MARKER, verifyGateLabels } from '../lib/gate-labels'
import { NO_PRODUCTION, forgeOf, prOf, publishReleases, watchProduction, watchReleaseChecks, watchRelease } from '../lib/release'
import { fileFindings } from '../lib/security-scan'
import { resync } from '../lib/knowledge'
import { watchKnowledgePrs } from '../lib/knowledge-edit'
import { decrypt } from '../lib/secrets'
import { scheduled } from '../lib/schedule'
import { startSecurityScan } from '../lib/security-scan'
import { budgetOut } from '../lib/escalation'

export const ACTIVE = ['queued', 'awaiting_session', 'running']
/** The lease of a session Run lasts this long after its last heartbeat. */
export const SESSION_TIMEOUT_MS = 30 * 60_000
export { stageOf }

/** Decision D2. Fallback only: pack/workflow.yaml (`exclude_labels` of the triage stage) is the source; a pack that yields none must not open Triage to these kinds. */
const D2_EXCLUDED = ['wayfinder:map', 'wayfinder:grilling', 'wayfinder:research', 'bauherr:security-scan']
export const excludedLabels = (stages: { name: string; exclude_labels?: string[] }[] = packed()): string[] => {
  const list = stages.find((s) => s.name === 'triage')?.exclude_labels
  return list?.length ? list : D2_EXCLUDED
}

/** Whether Triage covers the Ticket: open, unassigned, no stage label, not on hold, none of the `exclude_labels` of the triage stage in pack/workflow.yaml. */
export const triageable = (t: { state: string; labels: string[]; assignee?: string | null }, exclude = excludedLabels()): boolean =>
  t.state === 'open' && !t.assignee && !stageOf(t.labels) && !t.labels.includes(NEEDS_REFINEMENT) && !t.labels.some((l) => exclude.includes(l))

const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))

const findLlmProvider = async (payload: Payload, workspace: unknown) =>
  (
    await payload.find({
      collection: 'connections',
      where: { and: [{ workspace: { equals: id(workspace) } }, { kind: { equals: 'llm-provider' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0]

/** Queues a Run for the Ticket unless one is already active for that stage (then returns it, `created: false`). Atomic via the `runs_active_per_ticket_stage` index: Payload surfaces its 23505 as a ValidationError, so a failed create with an active Run now present means a concurrent start won. */
export const startRunIfNeeded = async (payload: Payload, ticket: { id: number | string; workspace?: unknown }, stage: string, extra: Record<string, unknown> = {}, req?: Partial<PayloadRequest>) => {
  const findActive = async () =>
    (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket.id } }, { stage: { equals: stage } }, { status: { in: ACTIVE } }] }, limit: 1, depth: 0, overrideAccess: true, req })).docs[0]
  const existing = await findActive()
  if (existing) return { run: existing, created: false }
  const workspace = id(ticket.workspace)
  const mode = await modeFor(payload, workspace, stage, req)
  let run
  try {
    run = await payload.create({
      collection: 'runs',
      data: { ticket: ticket.id, stage, mode, status: mode === 'session' ? 'awaiting_session' : 'queued', workspace, ...extra },
      req,
    })
  } catch (e) {
    const winner = (e as { name?: string }).name === 'ValidationError' && (await findActive())
    if (!winner) throw e
    return { run: winner, created: false }
  }
  if (mode === 'autonomous') await payload.jobs.queue({ task: 'run-stage', queue: 'runs', input: { runId: run.id }, req: req as PayloadRequest | undefined })
  return { run, created: true }
}

/** New Triage Runs per Workspace per poll; the rest wait for the next poll. */
export const TRIAGE_PER_POLL = 5
/** Triage attempts (failed, invalid or expired included) per Ticket state before Bauherr stops and says so. */
export const MAX_TRIAGE_ATTEMPTS = 3

/** Forgets what Triage covered, so the next poll triages the Ticket again. */
export const untriage = (payload: Payload, ticket: number | string) => payload.update({ collection: 'tickets', id: ticket, data: { triagedAt: null }, overrideAccess: true })

/** `untriage` for the end of a Run: a failure is logged and never masks the Run's own outcome. */
const untriageLogged = async (payload: Payload, ticket: number | string) => {
  try {
    await untriage(payload, ticket)
  } catch (e) {
    payload.logger.error({ err: e, ticket }, 'untriage failed')
  }
}

/** After MAX_TRIAGE_ATTEMPTS: one Comment, then the Ticket counts as covered until it changes (the Comment's own `updatedAt` is recorded). */
const giveUpTriage = async (payload: Payload, t: Record<string, any>) => {
  try {
    const { tickets: ts } = await forgeOf(payload, id(t.product))
    const n = String(t.number)
    await ts.comment(n, `Bauherr: triage failed ${MAX_TRIAGE_ATTEMPTS} times; label the Ticket or edit it to retry`)
    const at = (await ts.get(n)).updatedAt
    await payload.update({ collection: 'tickets', id: t.id, data: { triagedAt: at }, overrideAccess: true })
  } catch (e) {
    payload.logger.warn({ err: e, ticket: t.id }, 'triage give-up comment failed')
  }
}

/**
 * Starts a Triage Run (at most TRIAGE_PER_POLL per Workspace) for each open Ticket that is triageable and not yet covered at its current `sourceUpdatedAt`;
 * a skipped or held Ticket is triaged again only when it changes. Candidates are ordered by last attempt (never tried first), so a backlog rotates;
 * each new Run counts as an attempt, reset when the Ticket changes. Works from the stored Tickets, so a capped or untriaged Ticket is picked up by the next poll.
 */
/** Returns how many Tickets it acted on (Runs started plus Tickets given up on). */
export const triageSweep = async (payload: Payload): Promise<number> => {
  const open = await payload.find({ collection: 'tickets', where: { and: [{ state: { equals: 'open' } }, { stage: { exists: false } }] }, sort: 'createdAt', pagination: false, depth: 0, overrideAccess: true })
  const last = (t: Record<string, any>) => (t.triageAttemptAt ? new Date(t.triageAttemptAt).getTime() : 0)
  const candidates = (open.docs as Record<string, any>[])
    .filter((t) => !(t.triagedAt && t.sourceUpdatedAt && new Date(t.triagedAt).getTime() >= new Date(t.sourceUpdatedAt).getTime()) && !t.mergeSha && !t.expedite && triageable({ state: t.state, labels: t.labels ?? [], assignee: t.assignee }))
    .sort((a, b) => last(a) - last(b))
  const per = new Map<string, number>()
  let started = 0
  for (const t of candidates) {
    const ws = String(id(t.workspace))
    if ((per.get(ws) ?? 0) >= TRIAGE_PER_POLL) continue
    per.set(ws, (per.get(ws) ?? 0) + 1)
    if ((t.triageAttempts ?? 0) >= MAX_TRIAGE_ATTEMPTS) {
      await giveUpTriage(payload, t)
      started++
      continue
    }
    const { created } = await startRunIfNeeded(payload, t as { id: number | string; workspace?: unknown }, 'triage')
    await payload.update({
      collection: 'tickets',
      id: t.id,
      data: { triagedAt: t.triagedAt && t.sourceUpdatedAt && new Date(t.triagedAt) > new Date(t.sourceUpdatedAt) ? t.triagedAt : (t.sourceUpdatedAt ?? new Date().toISOString()), ...(created && { triageAttempts: (t.triageAttempts ?? 0) + 1, triageAttemptAt: new Date().toISOString() }) },
      overrideAccess: true,
    })
    started++
  }
  return started
}

/** Starts the Review Run of a Ticket in review that has an open factory MR and no review verdict state yet. */
export const startReviewIfReady = async (payload: Payload, t: Record<string, any>) => {
  if (t.stage !== 'review' || t.state !== 'open' || t.reviewState || t.waitingFor) return null
  const mr = await prOf(payload, t)
  if (mr?.pr.state !== 'open') return null
  // Review only green heads, whichever path moved the Ticket here (session, autonomous Runner, poller, pull from a full column). A review already under way is left alone.
  const live = await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'review' } }, { status: { in: ACTIVE } }] }, overrideAccess: true })
  if (!live.totalDocs) {
    const gate = await checksGate(payload, t, mr)
    if (gate.state !== 'green') {
      await parkForChecks(payload, t, mr, gate)
      return null
    }
  }
  // A fix round granted at the review round cap is reviewed on the strong tier too.
  const build = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'build' } }] }, sort: '-id', limit: 1, depth: 0, overrideAccess: true })).docs[0]
  return startRunIfNeeded(payload, t as { id: number | string; workspace?: unknown }, 'review', build?.escalation?.reason === REVIEW_CAP_REASON ? { escalation: build.escalation } : {})
}

/** Reason prefix of a human force-release; such a predecessor does not count toward the 2x escalation. */
export const RELEASED_BY = 'released by '

/**
 * Ends a leased session Run as `abandoned` and queues a successor Run (same Ticket, stage, mode, Workspace; `previousRun` set), in one transaction.
 * With `escalate`, a Run whose predecessor was also abandoned (not by a human release) goes `needs_human` instead (no successor, Ticket Comment).
 * The end is a conditional UPDATE (running, and with `staleBefore` still stale), so a heartbeat or finish that won the race keeps the Run.
 * Returns the new status, or null if the Run was not (stale and) running.
 */
export const abandonRun = async (
  payload: Payload,
  run: Record<string, any>,
  o: { reason: string; escalate: boolean; staleBefore?: string },
): Promise<'abandoned' | 'needs_human' | null> => {
  const prev = o.escalate && run.previousRun ? await payload.findByID({ collection: 'runs', id: id(run.previousRun), depth: 0, overrideAccess: true }) : null
  const status = prev?.status === 'abandoned' && !String(prev.error ?? '').startsWith(RELEASED_BY) ? 'needs_human' : 'abandoned'
  const error = status === 'needs_human' ? 'session lease expired twice in a row' : o.reason
  // The successor is the strong retry (ladder step 2); an investigation Run stays one.
  const escalation = run.escalation ?? (run.investigation || run.stage === 'triage' || run.stage === 'scan' ? null : { step: 2, reason: o.reason, previousRuns: [run.id] })
  const stale = o.staleBefore ? sql` AND "heartbeat_at" < ${o.staleBefore}` : sql``
  const ended = await payload.db.drizzle.transaction(async (tx: any) => {
    const done = await tx.execute(
      sql`UPDATE "runs" SET "status" = ${status}, "error" = ${error}, "reason_kind" = ${status === 'needs_human' ? 'stuck' : null}::"enum_runs_reason_kind", "finished_at" = now(), "lease_hash" = NULL, "session_owner_id" = NULL, "updated_at" = now() WHERE "id" = ${run.id} AND "mode" = 'session' AND "status" = 'running'${stale} RETURNING "id"`,
    )
    if (!done.rows.length) return false
    // The ended Run left the active set, so the `runs_active_per_ticket_stage` index admits the successor.
    if (status === 'abandoned') {
      await tx.execute(
        sql`INSERT INTO "runs" ("ticket_id", "stage", "mode", "status", "workspace_id", "previous_run_id", "escalation", "investigation") VALUES (${id(run.ticket)}, ${run.stage}, ${run.mode}, 'awaiting_session', ${id(run.workspace)}, ${run.id}, ${escalation ? JSON.stringify(escalation) : null}::jsonb, ${run.investigation ? JSON.stringify(run.investigation) : null}::jsonb)`,
      )
    }
    return true
  })
  if (!ended) return null
  if (status === 'abandoned' && escalation?.step === 2) {
    try {
      const { noteRetry } = await import('../lib/escalation')
      const ticket = await payload.findByID({ collection: 'tickets', id: id(run.ticket), depth: 0, overrideAccess: true })
      await noteRetry(payload, ticket, { ...run, status: 'abandoned' }, o.reason)
    } catch (e) {
      payload.logger.warn({ err: e, run: run.id }, 'escalation comment failed; the next liveness pass writes it')
    }
  }
  if (status === 'needs_human') {
    try {
      const ticket = await payload.findByID({ collection: 'tickets', id: id(run.ticket), depth: 0, overrideAccess: true })
      await (await forgeOf(payload, id(ticket.product))).tickets.comment(String(ticket.number), 'Bauherr needs a human: session lease expired twice in a row')
    } catch (e) {
      payload.logger.warn({ err: e, run: run.id }, 'needs_human comment failed')
    }
  }
  return status
}

/** Above the longest legitimate tick: forge back-off waits up to MAX_WAIT_MS x 3 retries per call (15 min) and a reclaimed job keeps running, so an earlier reclaim would let a second instance duplicate side effects. */
export const STALE_JOB_MS = 60 * 60_000

/** Scheduled poller tasks, derived from `TASKS`; agent Runs (`run-stage`, `reconcile-costs`) have no schedule and are never listed. */
export const scheduledSlugs = (): string[] => TASKS.filter((t) => t.schedule?.length).map((t) => t.slug)

/** Adds every task slug to the two Payload job enums (idempotent), so a new task needs no `ALTER TYPE` migration. Runs on init; skips an enum that does not exist yet (schema not migrated, the migrations create it). */
export const syncJobEnums = async (payload: Payload, slugs = TASKS.map((t) => t.slug)): Promise<void> => {
  for (const type of ['enum_payload_jobs_task_slug', 'enum_payload_jobs_log_task_slug']) {
    if (!(await payload.db.drizzle.execute(sql`SELECT to_regtype(${`public.${type}`}) AS t`)).rows[0]?.t) continue
    for (const slug of slugs) await payload.db.drizzle.execute(sql.raw(`ALTER TYPE "public"."${type}" ADD VALUE IF NOT EXISTS '${slug.replace(/'/g, "''")}'`))
  }
}

/** A scheduled job left `processing` with no update for `maxAgeMs` (default STALE_JOB_MS; killed worker, hung fetch; 0 at poller start, when no live process owns one) blocks its concurrency key forever: mark it failed so the schedule resumes. */
export const reclaimStaleJobs = async (payload: Payload, now = Date.now(), maxAgeMs = STALE_JOB_MS): Promise<number> => {
  const rows = (
    await payload.db.drizzle.execute(
      sql`UPDATE "payload_jobs" SET "processing" = false, "has_error" = true, "error" = ${JSON.stringify({ message: 'reclaimed: no progress' })}::jsonb, "updated_at" = now() WHERE "processing" AND "completed_at" IS NULL AND "task_slug"::text IN (${sql.join(scheduledSlugs().map((s) => sql`${s}`), sql`, `)}) AND "updated_at" < ${new Date(now - maxAgeMs).toISOString()} RETURNING "id", "task_slug"`,
    )
  ).rows
  for (const r of rows) payload.logger.warn({ job: r.id, task: r.task_slug }, 'reclaimed stale scheduled job')
  return rows.length
}

/** A running session Build Run is checked for a push once its heartbeat is this old, i.e. while its lease is still valid. */
const PUSH_CHECK_AFTER_MS = (SESSION_TIMEOUT_MS * 2) / 3

/**
 * A pushed branch is a sign of life. For running session Build Runs whose heartbeat is older than `PUSH_CHECK_AFTER_MS` but not expired yet, the head of the Run's branch (`bauherr/<ticket>-<run>`, else the head of the MR the Run carries in `artifacts.prUrl`) is compared with `last_seen_sha`; a different head renews the lease.
 * An expired lease is never revived here (a late owner still gets `lease lost`), and a forge error skips the Run for this sweep. A session that pushed once and then died gets one extra lease.
 * Returns how many leases were renewed.
 */
const renewOnPushes = async (payload: Payload, now: number): Promise<number> => {
  const expired = new Date(now - SESSION_TIMEOUT_MS).toISOString()
  const checkBefore = new Date(now - PUSH_CHECK_AFTER_MS).toISOString()
  const due = await payload.find({
    collection: 'runs',
    where: { and: [{ mode: { equals: 'session' } }, { status: { equals: 'running' } }, { stage: { equals: 'build' } }, { heartbeatAt: { less_than: checkBefore } }, { heartbeatAt: { greater_than_equal: expired } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  let renewed = 0
  for (const run of due.docs) {
    try {
      const ticket = await payload.findByID({ collection: 'tickets', id: id(run.ticket), depth: 0, overrideAccess: true })
      const { backend, repo } = await forgeOf(payload, id(ticket.product))
      const head = (await backend.forge.getBranch(repo, `bauherr/${ticket.number}-${run.id}`))?.sha ?? ((run.artifacts as { prUrl?: string } | null)?.prUrl ? (await prOf(payload, ticket, { fallback: true }))?.pr.headSha : undefined)
      if (!head || head === run.lastSeenSha) continue
      const r = await payload.db.drizzle.execute(
        sql`UPDATE "runs" SET "heartbeat_at" = now(), "last_seen_sha" = ${head}, "updated_at" = now() WHERE "id" = ${run.id} AND "mode" = 'session' AND "status" = 'running' AND "heartbeat_at" < ${checkBefore} AND "heartbeat_at" >= ${expired} RETURNING "id"`,
      )
      if (r.rows.length) renewed++
    } catch (e) {
      payload.logger.warn({ err: e, run: run.id }, 'branch head check failed; skipped this sweep')
    }
  }
  return renewed
}

/** Session Runs: running ones without a heartbeat for SESSION_TIMEOUT_MS are abandoned (see `abandonRun`); unclaimed ones, Triage included, wait indefinitely (an expiring Triage Run used up the Ticket's triage attempts and dropped it from Triage). A Build Run that pushed to its branch is renewed before it expires (`renewOnPushes`). Returns how many were abandoned. */
export const expireStaleSessions = async (payload: Payload, now = Date.now()): Promise<number> => {
  await renewOnPushes(payload, now)
  const before = new Date(now - SESSION_TIMEOUT_MS).toISOString()
  const stale = await payload.find({
    collection: 'runs',
    where: { and: [{ mode: { equals: 'session' } }, { status: { equals: 'running' } }, { heartbeatAt: { less_than: before } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  let handled = 0
  for (const run of stale.docs) {
    try {
      const reason = `session lease expired (last sign of life ${new Date(run.heartbeatAt).toISOString()}, last call ${run.lastLeaseCall ?? 'none'})`
      if (await abandonRun(payload, run, { reason, escalate: run.stage !== 'triage' && run.stage !== 'scan', staleBefore: before })) handled++
    } catch (e) {
      payload.logger.error({ err: e, run: run.id }, 'abandonRun failed')
    }
  }
  return handled
}

/** Second reclaimer: `expire-sessions` and this task reclaim each other, so a poller kill mid-run of either cannot leave a row `processing` forever. */
export const reclaimJobs: TaskConfig<{ input: Record<string, never>; output: { reclaimed: number } }> = {
  slug: 'reclaim-jobs',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  handler: async ({ req }) => ({ output: { reclaimed: await reclaimStaleJobs(req.payload) } }),
}

export const expireSessions: TaskConfig<{ input: Record<string, never>; output: { expired: number } }> = {
  slug: 'expire-sessions',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  handler: async ({ req }) => {
    await reclaimStaleJobs(req.payload)
    return { output: { expired: await expireStaleSessions(req.payload) } }
  },
}

/** One scheduled task per watcher: separate DB jobs and concurrency keys, so a hung or failing watcher blocks no other. */
const watcher = (slug: string, run: (payload: Payload) => Promise<unknown>): TaskConfig<{ input: Record<string, never>; output: Record<string, never> }> => ({
  slug,
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  concurrency: () => slug,
  handler: async ({ req }) => {
    await run(req.payload)
    await syncGates(req.payload, true) // a Hotfix's gate notice goes out in the same pass, not on the next sweep
    return { output: {} }
  },
})

export const watchReviewsTask = watcher('watch-reviews', async (p) => {
  await watchReviews(p)
  await watchQueued(p)
  await runTrains(p)
  await watchChecks(p)
})
export const watchProductionTask = watcher('watch-production', (p) => watchProduction(p))
export const resumeReviewsTask = watcher('resume-reviews', async (p) => {
  await resumeReviews(p)
  await restartParkedReviews(p)
})
export const watchReleaseTask = watcher('watch-release', (p) => watchRelease(p))

/** Every 5 minutes: repairs Tickets that have no live Run, no wait and no need for the owner (see `lib/liveness.ts`). */
export const watchLivenessTask: TaskConfig<{ input: Record<string, never>; output: { repaired: number } }> = {
  slug: 'watch-liveness',
  schedule: scheduled('0 */5 * * * *'),
  retries: 0,
  concurrency: () => 'watch-liveness',
  handler: async ({ req }) => ({ output: { repaired: await (await import('../lib/liveness')).sweepLiveness(req.payload) } }),
}

export const publishReleaseTask: TaskConfig<{ input: Record<string, never>; output: { published: number } }> = {
  slug: 'publish-release',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  concurrency: () => 'publish-release',
  handler: async ({ req }) => {
    const published = await publishReleases(req.payload)
    await watchReleaseChecks(req.payload)
    return { output: { published } }
  },
}

export const notifyGatesTask: TaskConfig<{ input: Record<string, never>; output: { changed: number } }> = {
  slug: 'notify-gates',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  concurrency: () => 'notify-gates',
  handler: async ({ req }) => ({ output: { changed: await syncGates(req.payload) } }),
}

export const resyncKnowledge: TaskConfig<{ input: Record<string, never>; output: { indexed: number } }> = {
  slug: 'resync-knowledge',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  concurrency: () => 'resync-knowledge',
  handler: async ({ req }) => {
    const { payload } = req
    let indexed = 0
    for (const w of (await payload.find({ collection: 'workspaces', limit: 1000, pagination: false, depth: 0, select: { id: true }, overrideAccess: true })).docs) {
      try {
        if (await resync(payload, w.id)) indexed++
      } catch (e) {
        payload.logger.error({ err: e, workspace: w.id }, 'resync-knowledge failed')
      }
    }
    return { output: { indexed } }
  },
}

/** Polls in which a Ticket's unverifiable gate label is retried before it waits for the next label change. */
const MAX_GATE_ATTEMPTS = 30

/** Plan gate off (or an expedite Ticket): advances every open Ticket in `plan` whose plan Run has succeeded; a failing Ticket does not stop the others. */
const advancePlans = async (payload: Payload): Promise<void> => {
  const tickets = await payload.find({ collection: 'tickets', where: { and: [{ stage: { equals: 'plan' } }, { state: { equals: 'open' } }, ...(gateOn('plan') ? [{ expedite: { equals: true } }] : [])] }, pagination: false, depth: 0, overrideAccess: true })
  for (const t of tickets.docs) await advancePlan(payload, t).catch((e) => payload.logger.error({ err: e, ticket: t.id }, 'advancePlan failed'))
}

/** True while a blocker (loaded at depth 1) is not closed. */
const hasOpenBlocker = (t: Record<string, any>): boolean => ((t.blockedBy as { state?: string }[] | undefined) ?? []).some((b) => b.state !== 'closed')

/** Starts one Run for every open `plan`/`build` Ticket that never had a Run in its stage, has no open blocker and is assigned only to its gate assignees. Never re-runs a stage that already had a Run. */
const startMissingRuns = async (payload: Payload): Promise<void> => {
  const tickets = await payload.find({ collection: 'tickets', where: { and: [{ stage: { in: ['plan', 'build'] } }, { state: { equals: 'open' } }] }, limit: 200, depth: 1, overrideAccess: true })
  for (const t of tickets.docs) {
    try {
      if (t.waitingFor || hasOpenBlocker(t)) continue
      if (!logins(t.assignees).every((a) => logins(t.gateAssignees).includes(a))) continue
      if ((await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: t.stage } }] }, overrideAccess: true })).totalDocs) continue
      if (t.stage === 'build' && (await holdOverlap(payload, t))) continue
      await startRunIfNeeded(payload, t as { id: number | string; workspace?: unknown }, t.stage as string)
      payload.logger.info({ ticket: t.id, stage: t.stage }, 'run started for a Ticket without one')
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'startMissingRuns failed')
    }
  }
}

export const watchKnowledgePrsTask: TaskConfig<{ input: Record<string, never>; output: { merged: number } }> = {
  slug: 'watch-knowledge-prs',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  concurrency: () => 'watch-knowledge-prs',
  handler: async ({ req }) => ({ output: { merged: await watchKnowledgePrs(req.payload) } }),
}

/** The forge is the truth for dependencies: the full `blockedBy` set (Ticket ids of the Product; a blocker not polled yet is ignored). A Ticket naming itself is ignored. Empty object on a read error, which keeps the stored set (the Ticket is read again the next time it changes on the forge). */
const forgeBlockers = async (payload: Payload, forge: TicketSource, product: number | string, number: number): Promise<{ blockedBy?: (number | string)[] }> => {
  try {
    const blockedBy = (await forge.get(String(number))).blockedBy.filter((n) => n !== String(number))
    const known = blockedBy.length ? await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { externalId: { in: blockedBy } }] }, pagination: false, depth: 0, overrideAccess: true }) : { docs: [] }
    return { blockedBy: known.docs.map((d) => d.id) }
  } catch (e) {
    payload.logger.warn({ err: e, ticket: number }, 'forge dependencies unreadable, keeping the stored set')
    return {}
  }
}

export const pollTickets: TaskConfig<{ input: Record<string, never>; output: { polled: number } }> = {
  slug: 'poll-tickets',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  handler: async ({ req }) => {
    const { payload } = req
    const sources = await payload.find({ collection: 'ticket_sources', limit: 1000, pagination: false, depth: 0, overrideAccess: true })
    for (const src of sources.docs) {
      try {
        const conn = await connectionInput(payload, src.connection)
        const { changes, next } = await backendFor(conn).tickets(src.repo).poll(src.cursor ?? null)
        // Tickets whose gate label could not be verified yet are re-read on every poll, a bounded number of times.
        const stuck = await payload.find({
          collection: 'tickets',
          where: { and: [{ product: { equals: id(src.product) } }, { gatePendingAttempts: { greater_than: 0 } }, { gatePendingAttempts: { less_than: MAX_GATE_ATTEMPTS } }, { number: { not_in: changes.map((c) => c.number) } }] },
          pagination: false,
          depth: 0,
          overrideAccess: true,
        })
        const fetched = await Promise.allSettled(stuck.docs.map((d) => backendFor(conn).tickets(src.repo).get(String(d.number))))
        const retried = []
        for (const [i, r] of fetched.entries()) {
          if (r.status === 'fulfilled') retried.push(r.value)
          else {
            payload.logger.warn({ err: r.reason, ticket: stuck.docs[i].id }, 'pending gate Ticket unreadable, no more retries')
            await payload.update({ collection: 'tickets', id: stuck.docs[i].id, data: { gatePendingAttempts: MAX_GATE_ATTEMPTS }, depth: 0, overrideAccess: true })
          }
        }
        let revertFailed = false
        const lane = await laneOn(payload, id(src.workspace))
        for (const t of [...changes, ...retried]) {
          const found = await payload.find({
            collection: 'tickets',
            where: { and: [{ product: { equals: id(src.product) } }, { externalId: { equals: t.id } }] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          let prev = found.docs[0]
          const base = {
            workspace: id(src.workspace),
            product: id(src.product),
            externalId: t.id,
            number: t.number,
            url: t.url,
            title: t.title,
            state: t.state,
            labels: t.labels,
            assignee: t.assignee,
            assignees: t.assignees.join(','),
            sourceUpdatedAt: t.updatedAt,
            triageAttempts: 0,
            gatePendingAttempts: 0,
            expedite: lane && t.labels.includes(EXPEDITE_LABEL),
            expediteAt: undefined as string | undefined,
          }
          if (!lane && t.labels.includes(EXPEDITE_LABEL)) await noteIgnored(payload, backendFor(conn).tickets(src.repo), t.number)
          let labels = t.labels
          if (GATE_LABELS.some((g) => labels.includes(g.label))) {
            prev ??= await upsertTicket(payload, { ...base, sourceUpdatedAt: null, stage: stageOf(labels), rank: await lastRankAfter(payload, id(src.workspace)) }, null)
            const { rejected, pending } = await verifyGateLabels(payload, prev, labels, backendFor(conn).tickets(src.repo))
            labels = labels.filter((l) => !rejected.includes(l) && !pending.includes(l))
            base.labels = labels
            base.expedite = lane && labels.includes(EXPEDITE_LABEL)
            base.gatePendingAttempts = pending.length ? (prev.gatePendingAttempts ?? 0) + 1 : 0
          }
          if (base.expedite && !prev?.expediteAt) base.expediteAt = new Date().toISOString()
          let stage = stageOf(labels)
          if (prev?.stage && t.state === 'open' && (stage === null && prev.stage !== 'triage' || (prev.stage === 'release' && prev.mergeSha && stage === 'review'))) {
            stage = prev.stage
            payload.logger.warn({ ticket: t.number, stage }, 'stage label restored from DB')
            try { await setStage(backendFor(conn).tickets(src.repo), String(t.number), prev.stage) } catch (e) { payload.logger.warn({ ticket: t.number, err: String(e) }, 'stage label repair failed') }
          }
          // Stage guard (#196): a forward move the factory did not record is reverted to the DB stage; backward moves and first sight are accepted.
          let clearFactoryStage = false
          if (prev && stage && stage !== (prev.stage ?? 'triage')) {
            clearFactoryStage = true
            if (stage !== prev.factoryStage && isForward(prev.stage ?? 'triage', stage)) {
              const from = prev.stage
              const back = from ? `to \`${from}\`` : 'to untriaged'
              const marker = `<!-- bauherr:stage-rejected:${stage}:${t.updatedAt} -->`
              const forge = backendFor(conn).tickets(src.repo)
              try {
                if (from) await setStage(forge, String(t.number), from)
                else await forge.removeLabels(String(t.number), labels.filter((l) => stageOf([l]) !== null))
                if (!(await forge.listComments(String(t.number))).some((c) => c.body.startsWith(marker))) {
                  await forge.comment(String(t.number), `${marker}\nBauherr moved the stage back ${back}: a forward move to \`${stage}\` counts only when the factory made it. Use the buttons on the Ticket page.`)
                }
                labels = [...labels.filter((l) => stageOf([l]) === null), ...(from ? [stageLabel(from)] : [])]
                base.labels = labels
                stage = from
              } catch (e) {
                payload.logger.warn({ err: e, ticket: prev.id }, 'stage revert failed, keeping the DB stage, retried on the next poll')
                revertFailed = true
                continue
              }
            }
          }
          // Derived event (spec §3): approval label + stage plan advances the Ticket to build, or to `parent` when its plan lists Sub-tickets.
          if (stage === 'plan' && t.state === 'open' && labels.includes(APPROVED_PLAN) && !(await holdsRefine(backendFor(conn).tickets(src.repo), String(t.number)))) {
            prev ??= await upsertTicket(payload, { ...base, sourceUpdatedAt: null, stage, rank: await lastRankAfter(payload, id(src.workspace)) }, null)
            if (await spawnSubTickets(payload, prev)) stage = 'parent'
            else {
              const entered = await enterStage(payload, prev, 'build', async () => {
                await moveStage(payload, backendFor(conn).tickets(src.repo), { product: src.product, number: t.number }, 'build')
                await payload.update({ collection: 'tickets', id: prev!.id, data: { stage: 'build' }, depth: 0, overrideAccess: true })
              })
              if (entered === 'moved') stage = 'build'
            }
          }
          // Guard: unchanged pointers are not rewritten.
          if (!base.gatePendingAttempts && !prev?.gatePendingAttempts && prev && prev.sourceUpdatedAt && new Date(prev.sourceUpdatedAt).getTime() === new Date(t.updatedAt).getTime()) continue
          if (prev?.factoryStage && stage === prev.factoryStage) clearFactoryStage = true
          const data = {
            ...base,
            ...(await forgeBlockers(payload, backendFor(conn).tickets(src.repo), id(src.product), t.number)),
            stage,
            ...(prev?.stage === 'release' && stage !== 'release' && prev.productionState && prev.productionState !== 'deployed' && NO_PRODUCTION),
            ...(stage === 'release' && !prev?.releaseState && { releaseAt: new Date().toISOString(), releaseState: 'waiting' }),
          }
          const ticket = prev
            ? await payload.update({ collection: 'tickets', id: prev.id, data, overrideAccess: true })
            : await upsertTicket(payload, { ...data, rank: await lastRankAfter(payload, id(src.workspace)) }, data)
          if (clearFactoryStage && prev?.factoryStage) await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "factory_stage" = NULL WHERE "id" = ${prev.id} AND "factory_stage" = ${prev.factoryStage}`)
          const entered = stage && stage !== (prev?.stage ?? null)
          const current = entered ? await payload.findByID({ collection: 'tickets', id: ticket.id, depth: 1, overrideAccess: true }) : null
          if (entered && (stage === 'plan' || stage === 'build') && t.state === 'open' && !current?.waitingFor && !hasOpenBlocker(current ?? {}) && t.assignees.every((a) => logins(current?.gateAssignees).includes(a)) && !(stage === 'build' && current && (await holdOverlap(payload, current)))) {
            await startRunIfNeeded(payload, ticket, stage)
          }
          if (entered && stage === 'review') await startReviewIfReady(payload, ticket)
        }
        await payload.update({ collection: 'ticket_sources', id: src.id, data: { ...(next !== (src.cursor ?? null) && !revertFailed && { cursor: next }), lastPolledAt: new Date().toISOString(), lastError: null }, overrideAccess: true })
      } catch (e) {
        payload.logger.error({ err: e, source: src.id }, 'poll-tickets failed for source')
        await payload
          .update({ collection: 'ticket_sources', id: src.id, data: { lastPolledAt: new Date().toISOString(), lastError: String((e as Error).message ?? e).slice(0, 500) }, overrideAccess: true })
          .catch(() => {})
      }
    }
    await closeFinishedParents(payload)
    await pullWaiting(payload)
    await startExpedites(payload)
    await startMissingRuns(payload)
    await advancePlans(payload)
    await triageSweep(payload)
    return { output: { polled: sources.docs.length } }
  },
}

export const runStage: TaskConfig<{ input: { runId: number | string }; output: { status: string } }> = {
  slug: 'run-stage',
  retries: 0,
  concurrency: ({ input }) => `run:${input.runId}`,
  inputSchema: [{ name: 'runId', type: 'number', required: true }],
  handler: async ({ input, req }) => {
    const { payload } = req
    const opts = { overrideAccess: true, depth: 0 } as const
    const run = await payload.findByID({ collection: 'runs', id: input.runId, ...opts })
    if (run.status !== 'queued') return { output: { status: run.status } }
    const ticket = await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...opts })
    const product = await payload.findByID({ collection: 'products', id: id(ticket.product), ...opts })
    const src = (
      await payload.find({ collection: 'ticket_sources', where: { product: { equals: product.id } }, limit: 1, ...opts })
    ).docs[0]
    const github = await connectionInput(payload, src.connection)
    const claimed = await payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'running', "started_at" = now() WHERE "id" = ${run.id} AND "status" = 'queued' RETURNING "id"`)
    if (!claimed.rows.length) return { output: { status: 'running' } }

    try {
      if (!(await findLlmProvider(payload, run.workspace))) throw new Error('no LLM provider connected')
      const ws = (await payload.findByID({ collection: 'workspaces', id: id(run.workspace), ...opts, showHiddenFields: true })) as { gatewayKey?: string }
      if (!ws.gatewayKey) throw new Error('workspace has no gateway key')
      const ctx = await buildRunCtx(payload, { run, ticket, repo: src.repo, github, gatewayKey: decrypt(ws.gatewayKey) })
      const r = await exec(ctx)
      const review = run.stage === 'review' && r.status === 'succeeded' ? normalizeReview(r.artifacts.review) : null
      let triage = null
      // The Ticket is untriaged only after the Run's terminal update, so the next poll cannot start a Triage Run while this one is still active.
      let untriageAfter = run.stage === 'triage' && r.status === 'failed' && !!r.reason?.includes('triage.json')
      if (run.stage === 'triage' && r.status === 'succeeded') {
        triage = normalizeTriage(r.artifacts.triage)
      }
      // A stopped Triage Run posts no Ticket Comment (it would bump the Ticket and reset the attempt count): the sweep retries it up to MAX_TRIAGE_ATTEMPTS.
      if (run.stage === 'triage' && (r.status === 'needs_human' || r.status === 'budget_exhausted')) untriageAfter = true
      else if (r.status === 'needs_human') {
        await backendFor(github).tickets(src.repo).comment(String(ticket.number), `Bauherr needs a human: ${r.reason ?? 'unmet Goal'}`)
      } else if (r.status === 'budget_exhausted') {
        await backendFor(github).tickets(src.repo).comment(String(ticket.number), 'Bauherr stopped: the Workspace budget is exhausted')
      }
      await payload.update({
        collection: 'runs',
        id: run.id,
        data: {
          status: r.status,
          artifacts: review ? { ...r.artifacts, review: { markdown: review.markdown, ...(review.problem && { problem: review.problem }) } } : r.artifacts,
          error: r.status === 'succeeded' ? null : r.reason,
          ...(r.status === 'needs_human' && { reasonKind: r.reasonKind ?? 'decision' }),
          ...(review && { verdict: review.verdict, findings: review.findings, reviewedSha: r.artifacts.reviewedSha ?? null, reviewedPatchId: r.artifacts.reviewedPatchId || null }),
          tokensIn: r.usage.inputTokens,
          tokensOut: r.usage.outputTokens,
          tokensCache: r.usage.cacheRead + r.usage.cacheWrite,
          costEstimateUsd: r.usage.costEstimateUsd,
          finishedAt: new Date().toISOString(),
        },
        ...opts,
      })
      if (untriageAfter) await untriageLogged(payload, ticket.id)
      await queueReconcile(payload, run.id)
      if (run.stage === 'scan' && (r.status === 'succeeded' || r.status === 'budget_exhausted') && r.artifacts.scan) await fileFindings(payload, { ...run, artifacts: r.artifacts })
      if (review) await concludeReview(payload, ticket.id, review, r.artifacts.reviewedSha ?? null)
      if (triage) await submitTriage(payload, ticket.id, triage)
      if (run.investigation && r.status === 'succeeded') await concludeInvestigation(payload, ticket, run, r.artifacts.investigation, ctx.connection.modelByTier.strong)
      if (run.stage === 'build' && r.status === 'succeeded' && r.artifacts.prUrl) {
        // The Runner moved the stage label already; the poller has not yet moved the Ticket, so do it here and start the review now.
        try {
          const reviewing = await payload.findByID({ collection: 'tickets', id: ticket.id, ...opts })
          if (!(await rebindReview(payload, reviewing))) await startReviewIfReady(payload, reviewing)
        } catch (e) {
          payload.logger.error({ err: e, ticket: ticket.id }, 'starting the review failed')
        }
      }
      return { output: { status: r.status } }
    } catch (e) {
      await payload.update({
        collection: 'runs',
        id: run.id,
        data: { status: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() },
        ...opts,
      })
      if (run.stage === 'triage') await untriageLogged(payload, ticket.id)
      await queueReconcile(payload, run.id)
      throw e
    }
  },
}

/** An autonomous investigation Run ends with its `.bauherr/investigation.json`: record it; a question for the owner ends the Run `needs_human`. A bad file fails the Run. */
export const concludeInvestigation = async (payload: Payload, ticket: Record<string, any>, run: Record<string, any>, input: unknown, model?: string) => {
  const fail = (error: string) => payload.update({ collection: 'runs', id: run.id, data: { status: 'failed', error }, overrideAccess: true })
  try {
    const stored = await payload.findByID({ collection: 'runs', id: run.id, depth: 0, overrideAccess: true })
    await submitInvestigation(payload, stored, { ...(input as InvestigationInput), model })
    if ((input as InvestigationInput).decision === 'needs-human') {
      const question = (input as InvestigationInput).question!
      await payload.update({ collection: 'runs', id: run.id, data: { status: 'needs_human', error: question, reasonKind: 'decision' }, overrideAccess: true })
      await (await forgeOf(payload, id(ticket.product))).tickets.comment(String(ticket.number), `Bauherr needs a human: ${question}`)
    }
  } catch (e) {
    await fail(`investigation: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export const mergeMainTask: TaskConfig<{ input: { ticketId: number; reviewedSha?: string | null }; output: Record<string, never> }> = {
  slug: 'merge-main',
  retries: 0,
  concurrency: { key: ({ input }) => `merge-main:${input.ticketId}`, exclusive: true, supersedes: true },
  inputSchema: [{ name: 'ticketId', type: 'number', required: true }, { name: 'reviewedSha', type: 'text' }],
  handler: async ({ input, req }) => {
    await mergeMainIntoMr(req.payload, input.ticketId, input.reviewedSha ?? null)
    return { output: {} }
  },
}

export const distillSkillTask: TaskConfig<{ input: { ticketId: number }; output: { outcome: string } }> = {
  slug: 'distill-skill',
  retries: 0,
  concurrency: { key: ({ input }) => `distill:${input.ticketId}`, exclusive: true },
  inputSchema: [{ name: 'ticketId', type: 'number', required: true }],
  handler: async ({ input, req }) => ({ output: { outcome: await distillSkill(req.payload, input.ticketId) } }),
}

export const reconcileCosts: TaskConfig<{ input: { runId: number; attempt?: number }; output: { status: string } }> = {
  slug: 'reconcile-costs',
  retries: 0,
  inputSchema: [
    { name: 'runId', type: 'number', required: true },
    { name: 'attempt', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    if (!gatewayDbEnabled()) return { output: { status: 'skipped' } }
    return { output: { status: await reconcileRun(req.payload, input.runId, input.attempt ?? 1) } }
  },
}

export const pruneRequestLogsTask: TaskConfig<{ input: Record<string, never>; output: { deleted: number } }> = {
  slug: 'prune-request-logs',
  schedule: scheduled('0 0 3 * * *'),
  retries: 0,
  handler: async ({ req }) => {
    if (!gatewayDbEnabled()) return { output: { deleted: 0 } }
    const deleted = await pruneRequestLogs()
    req.payload.logger.info({ deleted, retentionDays: retentionDays() }, 'prune-request-logs')
    return { output: { deleted } }
  },
}

export const pruneCommentMediaTask: TaskConfig<{ input: Record<string, never>; output: { deleted: number } }> = {
  slug: 'prune-comment-media',
  schedule: scheduled('0 30 3 * * *'),
  retries: 0,
  handler: async ({ req }) => ({ output: { deleted: await pruneCommentMedia(req.payload) } }),
}

/** Products scanned per tick; the rest wait for the next hour. */
export const SCANS_PER_TICK = 5

/** Starts a scan Run for up to SCANS_PER_TICK enabled Products whose `securityScan.cron` fired since `lastScanAt` (or creation), oldest scan first; a Product whose Workspace budget is spent is skipped with a warning. Returns the Runs created. */
export const securityScanSweep = async (payload: Payload, now = new Date()): Promise<number> => {
  const products = (await payload.find({ collection: 'products', where: { 'securityScan.enabled': { equals: true } }, pagination: false, depth: 0, overrideAccess: true })).docs as Record<string, any>[]
  const since = (p: Record<string, any>) => new Date(p.securityScan?.lastScanAt ?? p.createdAt)
  const due = products
    .filter((p) => {
      try {
        const next = new Cron(p.securityScan.cron || '0 0 4 * * 1').nextRun(since(p))
        return !!next && next <= now
      } catch (e) {
        payload.logger.warn({ err: e, product: p.id }, 'security scan: invalid cron')
        return false
      }
    })
    .sort((a, b) => since(a).getTime() - since(b).getTime())
    .slice(0, SCANS_PER_TICK)
  let started = 0
  for (const p of due) {
    if (await budgetOut(payload, id(p.workspace))) {
      payload.logger.warn({ product: p.id }, 'security scan skipped: budget spent')
      continue
    }
    const created = (await startSecurityScan(payload, p.id)).created
    if (created) started++
  }
  return started
}

export const securityScanTick: TaskConfig<{ input: Record<string, never>; output: { started: number } }> = {
  slug: 'security-scan-tick',
  schedule: scheduled('0 0 * * * *'),
  retries: 0,
  handler: async ({ req }) => ({ output: { started: await securityScanSweep(req.payload) } }),
}

export const TASKS = [pollTickets, runStage, mergeMainTask, distillSkillTask, expireSessions, reclaimJobs, reconcileCosts, pruneRequestLogsTask, pruneCommentMediaTask, watchReleaseTask, watchReviewsTask, watchProductionTask, resumeReviewsTask, publishReleaseTask, notifyGatesTask, resyncKnowledge, watchKnowledgePrsTask, watchLivenessTask, securityScanTick]
