import { sql } from '@payloadcms/db-postgres'
import type { Payload, TaskConfig } from 'payload'
import { APPROVED_PLAN, setStage, stageLabel } from '@bauherr/adapters'
import { runStage as exec } from '@bauherr/runner'
import { backendFor } from '../lib/adapters'
import { connectionInput } from '../lib/connection'
import { buildRunCtx } from '../lib/run-ctx'
import { gateOn, modeFor, packed } from '../lib/mode'
import { gatewayDbEnabled, pruneRequestLogs, queueReconcile, reconcileRun, retentionDays } from '../lib/reconcile'
import { advancePlan, closeFinishedParents, holdsRefine, concludeReview, lastRankAfter, normalizeReview, normalizeTriage, resumeReviews, spawnSubTickets, submitTriage, upsertTicket, watchReviews } from '../lib/actions'
import { NEEDS_REFINEMENT } from '../lib/needs-you'
import { logins, syncGates } from '../lib/gates'
import { isForward, moveStage } from '../lib/stage-move'
import { GATE_LABELS, REJECTED_MARKER, verifyGateLabels } from '../lib/gate-labels'
import { NO_PRODUCTION, forgeOf, prOf, publishReleases, watchProduction, watchRelease } from '../lib/release'
import { resync } from '../lib/knowledge'
import { watchKnowledgePrs } from '../lib/knowledge-edit'
import { decrypt } from '../lib/secrets'

export const ACTIVE = ['queued', 'awaiting_session', 'running']
/** The lease of a session Run lasts this long after its last heartbeat. */
export const SESSION_TIMEOUT_MS = 30 * 60_000
const STAGE_LABEL = /^bauherr:stage:(.+)$/

export const stageOf = (labels: string[]): string | null =>
  labels.map((l) => STAGE_LABEL.exec(l)?.[1]).find(Boolean) ?? null

/** Decision D2. Fallback only: pack/workflow.yaml (`exclude_labels` of the triage stage) is the source; a pack that yields none must not open Triage to these kinds. */
const D2_EXCLUDED = ['wayfinder:map', 'wayfinder:grilling', 'wayfinder:research']
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
export const startRunIfNeeded = async (payload: Payload, ticket: { id: number | string; workspace?: unknown }, stage: string) => {
  const findActive = async () =>
    (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket.id } }, { stage: { equals: stage } }, { status: { in: ACTIVE } }] }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  const existing = await findActive()
  if (existing) return { run: existing, created: false }
  const workspace = id(ticket.workspace)
  const mode = await modeFor(payload, workspace, stage)
  let run
  try {
    run = await payload.create({
      collection: 'runs',
      data: { ticket: ticket.id, stage, mode, status: mode === 'session' ? 'awaiting_session' : 'queued', workspace },
    })
  } catch (e) {
    const winner = (e as { name?: string }).name === 'ValidationError' && (await findActive())
    if (!winner) throw e
    return { run: winner, created: false }
  }
  if (mode === 'autonomous') await payload.jobs.queue({ task: 'run-stage', queue: 'runs', input: { runId: run.id } })
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
    await payload.update({ collection: 'tickets', id: t.id, data: { triagedAt: at, sourceUpdatedAt: at }, overrideAccess: true })
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
    .filter((t) => !(t.triagedAt && t.sourceUpdatedAt && new Date(t.triagedAt).getTime() === new Date(t.sourceUpdatedAt).getTime()) && triageable({ state: t.state, labels: t.labels ?? [], assignee: t.assignee }))
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
      data: { triagedAt: t.sourceUpdatedAt ?? new Date().toISOString(), ...(created && { triageAttempts: (t.triageAttempts ?? 0) + 1, triageAttemptAt: new Date().toISOString() }) },
      overrideAccess: true,
    })
    started++
  }
  return started
}

/** Starts the Review Run of a Ticket in review that has an open factory MR and no review verdict state yet. */
export const startReviewIfReady = async (payload: Payload, t: Record<string, any>) => {
  if (t.stage !== 'review' || t.state !== 'open' || t.reviewState) return null
  const mr = await prOf(payload, t)
  return mr?.pr.state === 'open' ? startRunIfNeeded(payload, t as { id: number | string; workspace?: unknown }, 'review') : null
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
  const stale = o.staleBefore ? sql` AND "heartbeat_at" < ${o.staleBefore}` : sql``
  const ended = await payload.db.drizzle.transaction(async (tx: any) => {
    const done = await tx.execute(
      sql`UPDATE "runs" SET "status" = ${status}, "error" = ${error}, "finished_at" = now(), "lease_hash" = NULL, "session_owner_id" = NULL, "updated_at" = now() WHERE "id" = ${run.id} AND "mode" = 'session' AND "status" = 'running'${stale} RETURNING "id"`,
    )
    if (!done.rows.length) return false
    // The ended Run left the active set, so the `runs_active_per_ticket_stage` index admits the successor.
    if (status === 'abandoned') {
      await tx.execute(
        sql`INSERT INTO "runs" ("ticket_id", "stage", "mode", "status", "workspace_id", "previous_run_id") VALUES (${id(run.ticket)}, ${run.stage}, ${run.mode}, 'awaiting_session', ${id(run.workspace)}, ${run.id})`,
      )
    }
    return true
  })
  if (!ended) return null
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

/** Session Runs: running ones without a heartbeat for SESSION_TIMEOUT_MS are abandoned (see `abandonRun`); unclaimed ones wait indefinitely, except Triage Runs (`updatedAt` older than that), which end `abandoned`. Returns how many were handled. */
export const expireStaleSessions = async (payload: Payload, now = Date.now()): Promise<number> => {
  const before = new Date(now - SESSION_TIMEOUT_MS).toISOString()
  // An unclaimed Triage Run is not a human's problem: it ends `abandoned` and the Ticket is triaged again by the next poll.
  const triage = (
    await payload.db.drizzle.execute(
      sql`UPDATE "runs" SET "status" = 'abandoned', "error" = 'unclaimed triage expired', "finished_at" = ${new Date(now).toISOString()}, "updated_at" = now() WHERE "stage" = 'triage' AND "mode" = 'session' AND "status" = 'awaiting_session' AND "updated_at" < ${before} RETURNING "ticket_id"`,
    )
  ).rows
  for (const r of triage) await untriage(payload, Number(r.ticket_id))
  const stale = await payload.find({
    collection: 'runs',
    where: { and: [{ mode: { equals: 'session' } }, { status: { equals: 'running' } }, { heartbeatAt: { less_than: before } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  let handled = triage.length
  for (const run of stale.docs) {
    try {
      if (await abandonRun(payload, run, { reason: 'session lease expired', escalate: run.stage !== 'triage', staleBefore: before })) handled++
    } catch (e) {
      payload.logger.error({ err: e, run: run.id }, 'abandonRun failed')
    }
  }
  return handled
}

export const expireSessions: TaskConfig<{ input: Record<string, never>; output: { expired: number } }> = {
  slug: 'expire-sessions',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
  retries: 0,
  handler: async ({ req }) => ({ output: { expired: await expireStaleSessions(req.payload) } }),
}

export const watchReleaseTask: TaskConfig<{ input: Record<string, never>; output: { released: number; confirmed: number; timedOut: number } }> = {
  slug: 'watch-release',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
  retries: 0,
  concurrency: () => 'watch-release',
  handler: async ({ req }) => {
    await watchReviews(req.payload)
    await watchProduction(req.payload)
    await resumeReviews(req.payload)
    return { output: await watchRelease(req.payload) }
  },
}

export const publishReleaseTask: TaskConfig<{ input: Record<string, never>; output: { published: number } }> = {
  slug: 'publish-release',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
  retries: 0,
  concurrency: () => 'publish-release',
  handler: async ({ req }) => ({ output: { published: await publishReleases(req.payload) } }),
}

export const notifyGatesTask: TaskConfig<{ input: Record<string, never>; output: { changed: number } }> = {
  slug: 'notify-gates',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
  retries: 0,
  concurrency: () => 'notify-gates',
  handler: async ({ req }) => ({ output: { changed: await syncGates(req.payload) } }),
}

export const resyncKnowledge: TaskConfig<{ input: Record<string, never>; output: { indexed: number } }> = {
  slug: 'resync-knowledge',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
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

/** Plan gate off: advances every open Ticket in `plan` whose plan Run has succeeded; a failing Ticket does not stop the others. */
const advancePlans = async (payload: Payload): Promise<void> => {
  if (gateOn('plan')) return
  const tickets = await payload.find({ collection: 'tickets', where: { and: [{ stage: { equals: 'plan' } }, { state: { equals: 'open' } }] }, pagination: false, depth: 0, overrideAccess: true })
  for (const t of tickets.docs) await advancePlan(payload, t).catch((e) => payload.logger.error({ err: e, ticket: t.id }, 'advancePlan failed'))
}

export const watchKnowledgePrsTask: TaskConfig<{ input: Record<string, never>; output: { merged: number } }> = {
  slug: 'watch-knowledge-prs',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
  retries: 0,
  concurrency: () => 'watch-knowledge-prs',
  handler: async ({ req }) => ({ output: { merged: await watchKnowledgePrs(req.payload) } }),
}

export const pollTickets: TaskConfig<{ input: Record<string, never>; output: { polled: number } }> = {
  slug: 'poll-tickets',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
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
          }
          let labels = t.labels
          if (GATE_LABELS.some((g) => labels.includes(g.label))) {
            prev ??= await upsertTicket(payload, { ...base, sourceUpdatedAt: null, stage: stageOf(labels), rank: await lastRankAfter(payload, id(src.workspace)) }, null)
            const { rejected, pending } = await verifyGateLabels(payload, prev, labels, backendFor(conn).tickets(src.repo))
            labels = labels.filter((l) => !rejected.includes(l) && !pending.includes(l))
            base.labels = labels
            base.gatePendingAttempts = pending.length ? (prev.gatePendingAttempts ?? 0) + 1 : 0
          }
          let stage = stageOf(labels)
          // Stage guard (#196): a forward move the factory did not record is reverted to the DB stage; backward moves and first sight are accepted.
          let clearFactoryStage = false
          if (prev?.stage && stage && stage !== prev.stage) {
            if (stage === prev.factoryStage) clearFactoryStage = true
            else if (isForward(prev.stage, stage)) {
              const marker = `<!-- bauherr:stage-rejected:${stage}:${t.updatedAt} -->`
              const forge = backendFor(conn).tickets(src.repo)
              try {
                await setStage(forge, String(t.number), prev.stage)
                if (!(await forge.listComments(String(t.number))).some((c) => c.body.startsWith(marker))) {
                  await forge.comment(String(t.number), `${marker}\nBauherr moved the stage back to \`${prev.stage}\`: a forward move to \`${stage}\` counts only when the factory made it. Use the buttons on the Ticket page.`)
                }
                labels = [...labels.filter((l) => stageOf([l]) === null), stageLabel(prev.stage)]
                base.labels = labels
                stage = prev.stage
                clearFactoryStage = true
              } catch (e) {
                payload.logger.warn({ err: e, ticket: prev.id }, 'stage revert failed, keeping the DB stage')
                continue
              }
            }
          }
          // Derived event (spec §3): approval label + stage plan advances the Ticket to build, or to `parent` when its plan lists Sub-tickets.
          if (stage === 'plan' && t.state === 'open' && labels.includes(APPROVED_PLAN) && !(await holdsRefine(backendFor(conn).tickets(src.repo), String(t.number)))) {
            prev ??= await upsertTicket(payload, { ...base, sourceUpdatedAt: null, stage, rank: await lastRankAfter(payload, id(src.workspace)) }, null)
            if (await spawnSubTickets(payload, prev)) stage = 'parent'
            else {
              await moveStage(payload, backendFor(conn).tickets(src.repo), { product: src.product, number: t.number }, 'build')
              stage = 'build'
            }
          }
          // Guard: unchanged pointers are not rewritten.
          if (!base.gatePendingAttempts && !prev?.gatePendingAttempts && prev && prev.sourceUpdatedAt && new Date(prev.sourceUpdatedAt).getTime() === new Date(t.updatedAt).getTime()) continue
          const data = {
            ...base,
            stage,
            ...(clearFactoryStage && { factoryStage: null }),
            ...(prev?.stage === 'release' && stage !== 'release' && prev.productionState && prev.productionState !== 'deployed' && NO_PRODUCTION),
            ...(stage === 'release' && !prev?.releaseState && { releaseAt: new Date().toISOString(), releaseState: 'waiting' }),
          }
          const ticket = prev
            ? await payload.update({ collection: 'tickets', id: prev.id, data, overrideAccess: true })
            : await upsertTicket(payload, { ...data, rank: await lastRankAfter(payload, id(src.workspace)) }, data)
          const entered = stage && stage !== (prev?.stage ?? null)
          const current = entered ? await payload.findByID({ collection: 'tickets', id: ticket.id, depth: 0, overrideAccess: true }) : null
          if (entered && (stage === 'plan' || stage === 'build') && t.state === 'open' && t.assignees.every((a) => logins(current?.gateAssignees).includes(a))) {
            await startRunIfNeeded(payload, ticket, stage)
          }
          if (entered && stage === 'review') await startReviewIfReady(payload, ticket)
        }
        await payload.update({ collection: 'ticket_sources', id: src.id, data: { ...(next !== (src.cursor ?? null) && { cursor: next }), lastPolledAt: new Date().toISOString(), lastError: null }, overrideAccess: true })
      } catch (e) {
        payload.logger.error({ err: e, source: src.id }, 'poll-tickets failed for source')
        await payload
          .update({ collection: 'ticket_sources', id: src.id, data: { lastPolledAt: new Date().toISOString(), lastError: String((e as Error).message ?? e).slice(0, 500) }, overrideAccess: true })
          .catch(() => {})
      }
    }
    await closeFinishedParents(payload)
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
    await payload.update({ collection: 'runs', id: run.id, data: { status: 'running', startedAt: new Date().toISOString() }, ...opts })

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
          ...(review && { verdict: review.verdict, findings: review.findings, reviewedSha: r.artifacts.reviewedSha ?? null }),
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
      if (review) await concludeReview(payload, ticket.id, review, r.artifacts.reviewedSha ?? null)
      if (triage) await submitTriage(payload, ticket.id, triage)
      if (run.stage === 'build' && r.status === 'succeeded' && r.artifacts.prUrl) {
        // The Runner moved the stage label already; the poller has not yet moved the Ticket, so do it here and start the review now.
        try {
          await startReviewIfReady(payload, await payload.update({ collection: 'tickets', id: ticket.id, data: { stage: 'review' }, ...opts }))
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
  schedule: [{ cron: '0 0 3 * * *', queue: 'poll' }],
  retries: 0,
  handler: async ({ req }) => {
    if (!gatewayDbEnabled()) return { output: { deleted: 0 } }
    const deleted = await pruneRequestLogs()
    req.payload.logger.info({ deleted, retentionDays: retentionDays() }, 'prune-request-logs')
    return { output: { deleted } }
  },
}
