import type { Payload, TaskConfig } from 'payload'
import { APPROVED_PLAN, setStage } from '@bauherr/adapters'
import { runStage as exec } from '@bauherr/runner'
import { githubFor } from '../lib/adapters'
import { connectionInput } from '../lib/connection'
import { buildRunCtx } from '../lib/run-ctx'
import { modeFor } from '../lib/mode'
import { gatewayDbEnabled, pruneRequestLogs, queueReconcile, reconcileRun, retentionDays } from '../lib/reconcile'
import { forgeOf, watchRelease } from '../lib/release'
import { decrypt } from '../lib/secrets'

export const ACTIVE = ['queued', 'awaiting_session', 'running']
/** The lease of a session Run lasts this long after its last heartbeat. */
export const SESSION_TIMEOUT_MS = 30 * 60_000
const STAGE_LABEL = /^bauherr:stage:(.+)$/

export const stageOf = (labels: string[]): string | null =>
  labels.map((l) => STAGE_LABEL.exec(l)?.[1]).find(Boolean) ?? null

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

/**
 * Ends a leased session Run as `abandoned` and queues a successor Run (same Ticket, stage, mode, Workspace; `previousRun` set).
 * With `escalate`, a Run whose predecessor was also abandoned goes `needs_human` instead (no successor, Ticket Comment).
 * `staleBefore` keeps a Run whose heartbeat arrived meanwhile. Returns the new status, or null if the Run was not (stale and) running.
 */
export const abandonRun = async (
  payload: Payload,
  run: Record<string, any>,
  o: { reason: string; escalate: boolean; staleBefore?: string },
): Promise<'abandoned' | 'needs_human' | null> => {
  const prev = o.escalate && run.previousRun ? await payload.findByID({ collection: 'runs', id: id(run.previousRun), depth: 0, overrideAccess: true }) : null
  const status = prev?.status === 'abandoned' ? 'needs_human' : 'abandoned'
  const done = await payload.update({
    collection: 'runs',
    where: { and: [{ id: { equals: run.id } }, { status: { equals: 'running' } }, ...(o.staleBefore ? [{ heartbeatAt: { less_than: o.staleBefore } }] : [])] },
    data: { status, error: status === 'needs_human' ? 'session lease expired twice in a row' : o.reason, finishedAt: new Date().toISOString() },
    depth: 0,
    overrideAccess: true,
  })
  if (!done.docs.length) return null
  if (status === 'needs_human') {
    try {
      const ticket = await payload.findByID({ collection: 'tickets', id: id(run.ticket), depth: 0, overrideAccess: true })
      await (await forgeOf(payload, id(ticket.product))).tickets.comment(String(ticket.number), 'Bauherr needs a human: session lease expired twice in a row')
    } catch (e) {
      payload.logger.warn({ err: e, run: run.id }, 'needs_human comment failed')
    }
    return status
  }
  await payload.create({
    collection: 'runs',
    data: { ticket: id(run.ticket), stage: run.stage, mode: run.mode, status: 'awaiting_session', workspace: id(run.workspace), previousRun: run.id },
    overrideAccess: true,
  })
  return status
}

/** Session Runs: unclaimed ones older than SESSION_TIMEOUT_MS go `needs_human`; running ones without a heartbeat for that long are abandoned (see `abandonRun`). Returns how many were handled. */
export const expireStaleSessions = async (payload: Payload, now = Date.now()): Promise<number> => {
  const before = new Date(now - SESSION_TIMEOUT_MS).toISOString()
  const unclaimed = await payload.update({
    collection: 'runs',
    where: { and: [{ mode: { equals: 'session' } }, { status: { equals: 'awaiting_session' } }, { createdAt: { less_than: before } }] },
    data: { status: 'needs_human', error: 'session heartbeat timeout', finishedAt: new Date(now).toISOString() },
    overrideAccess: true,
  })
  const stale = await payload.find({
    collection: 'runs',
    where: { and: [{ mode: { equals: 'session' } }, { status: { equals: 'running' } }, { heartbeatAt: { less_than: before } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  let handled = unclaimed.docs.length
  for (const run of stale.docs) {
    try {
      if (await abandonRun(payload, run, { reason: 'session lease expired', escalate: true, staleBefore: before })) handled++
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
  handler: async ({ req }) => ({ output: await watchRelease(req.payload) }),
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
        const { changes, next } = await githubFor(conn).tickets(src.repo).poll(src.cursor ?? null)
        for (const t of changes) {
          const found = await payload.find({
            collection: 'tickets',
            where: { and: [{ product: { equals: id(src.product) } }, { externalId: { equals: t.id } }] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          const prev = found.docs[0]
          let stage = stageOf(t.labels)
          // Derived event (spec §3): approval label + stage plan advances the Ticket to build.
          if (stage === 'plan' && t.state === 'open' && t.labels.includes(APPROVED_PLAN)) {
            await setStage(githubFor(conn).tickets(src.repo), String(t.number), 'build')
            stage = 'build'
          }
          // Guard: unchanged pointers are not rewritten.
          if (prev && prev.sourceUpdatedAt && new Date(prev.sourceUpdatedAt).getTime() === new Date(t.updatedAt).getTime()) continue
          const data = {
            workspace: id(src.workspace),
            product: id(src.product),
            externalId: t.id,
            number: t.number,
            url: t.url,
            title: t.title,
            state: t.state,
            labels: t.labels,
            assignee: t.assignee,
            sourceUpdatedAt: t.updatedAt,
            stage,
            ...(stage === 'release' && !prev?.releaseState && { releaseAt: new Date().toISOString(), releaseState: 'waiting' }),
          }
          const ticket = prev
            ? await payload.update({ collection: 'tickets', id: prev.id, data, overrideAccess: true })
            : await payload.create({ collection: 'tickets', data, overrideAccess: true })
          const entered = stage && stage !== (prev?.stage ?? null)
          if (entered && (stage === 'plan' || stage === 'build') && t.state === 'open' && !t.assignee) {
            await startRunIfNeeded(payload, ticket, stage)
          }
        }
        await payload.update({ collection: 'ticket_sources', id: src.id, data: { ...(next !== (src.cursor ?? null) && { cursor: next }), lastPolledAt: new Date().toISOString(), lastError: null }, overrideAccess: true })
      } catch (e) {
        payload.logger.error({ err: e, source: src.id }, 'poll-tickets failed for source')
        await payload
          .update({ collection: 'ticket_sources', id: src.id, data: { lastPolledAt: new Date().toISOString(), lastError: String((e as Error).message ?? e).slice(0, 500) }, overrideAccess: true })
          .catch(() => {})
      }
    }
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
      if (r.status === 'needs_human') {
        await githubFor(github).tickets(src.repo).comment(String(ticket.number), `Bauherr needs a human: ${r.reason ?? 'unmet Goal'}`)
      }
      if (r.status === 'budget_exhausted') {
        await githubFor(github).tickets(src.repo).comment(String(ticket.number), 'Bauherr stopped: the Workspace budget is exhausted')
      }
      await payload.update({
        collection: 'runs',
        id: run.id,
        data: {
          status: r.status,
          artifacts: r.artifacts,
          error: r.status === 'succeeded' ? null : r.reason,
          tokensIn: r.usage.inputTokens,
          tokensOut: r.usage.outputTokens,
          tokensCache: r.usage.cacheRead + r.usage.cacheWrite,
          costEstimateUsd: r.usage.costEstimateUsd,
          finishedAt: new Date().toISOString(),
        },
        ...opts,
      })
      await queueReconcile(payload, run.id)
      return { output: { status: r.status } }
    } catch (e) {
      await payload.update({
        collection: 'runs',
        id: run.id,
        data: { status: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() },
        ...opts,
      })
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
