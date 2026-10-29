import type { Payload, TaskConfig } from 'payload'
import { APPROVED_PLAN, setStage } from '@bauherr/adapters'
import { runStage as exec } from '@bauherr/runner'
import { githubFor } from '../lib/adapters'
import type { ConnectionInput } from '../lib/connection'
import { buildRunCtx } from '../lib/run-ctx'
import { modeFor } from '../lib/mode'
import { decrypt } from '../lib/secrets'

const ACTIVE = ['queued', 'awaiting_session', 'running']
/** Session Runs without a heartbeat for this long go `needs_human`. */
export const SESSION_TIMEOUT_MS = 30 * 60_000
const STAGE_LABEL = /^bauherr:stage:(.+)$/

export const stageOf = (labels: string[]): string | null =>
  labels.map((l) => STAGE_LABEL.exec(l)?.[1]).find(Boolean) ?? null

const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))

/** Loads a Connection with its secret decrypted; the plaintext lives only in memory. */
export const connectionInput = async (payload: Payload, ref: unknown): Promise<ConnectionInput> => {
  const c = await payload.findByID({ collection: 'connections', id: id(ref), overrideAccess: true, showHiddenFields: true })
  const raw = (c as { secret?: string }).secret
  return {
    id: c.id,
    kind: c.kind,
    config: c.config ?? {},
    secret: raw ? decrypt(raw) : null,
    capabilities: c.capabilities ?? {},
  }
}

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

/** Queues a Run for the Ticket unless one is already active for that stage. */
export const startRunIfNeeded = async (payload: Payload, ticket: { id: number | string; workspace?: unknown }, stage: string) => {
  const active = await payload.count({
    collection: 'runs',
    where: { and: [{ ticket: { equals: ticket.id } }, { stage: { equals: stage } }, { status: { in: ACTIVE } }] },
  })
  if (active.totalDocs) return null
  const workspace = id(ticket.workspace)
  const mode = await modeFor(payload, workspace, stage)
  const run = await payload.create({
    collection: 'runs',
    data: { ticket: ticket.id, stage, mode, status: mode === 'session' ? 'awaiting_session' : 'queued', workspace },
  })
  if (mode === 'autonomous') await payload.jobs.queue({ task: 'run-stage', queue: 'runs', input: { runId: run.id } })
  return run
}

/** Moves session Runs without a heartbeat for SESSION_TIMEOUT_MS to `needs_human`; returns how many. */
export const expireStaleSessions = async (payload: Payload, now = Date.now()): Promise<number> => {
  const before = new Date(now - SESSION_TIMEOUT_MS).toISOString()
  const stale = await payload.update({
    collection: 'runs',
    where: {
      and: [
        { mode: { equals: 'session' } },
        {
          or: [
            { and: [{ status: { equals: 'running' } }, { heartbeatAt: { less_than: before } }] },
            { and: [{ status: { equals: 'awaiting_session' } }, { createdAt: { less_than: before } }] },
          ],
        },
      ],
    },
    data: { status: 'needs_human', error: 'session heartbeat timeout', finishedAt: new Date(now).toISOString() },
    overrideAccess: true,
  })
  return stale.docs.length
}

export const expireSessions: TaskConfig<{ input: Record<string, never>; output: { expired: number } }> = {
  slug: 'expire-sessions',
  schedule: [{ cron: '0 * * * * *', queue: 'poll' }],
  retries: 0,
  handler: async ({ req }) => ({ output: { expired: await expireStaleSessions(req.payload) } }),
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
          }
          const ticket = prev
            ? await payload.update({ collection: 'tickets', id: prev.id, data, overrideAccess: true })
            : await payload.create({ collection: 'tickets', data, overrideAccess: true })
          const entered = stage && stage !== (prev?.stage ?? null)
          if (entered && (stage === 'plan' || stage === 'build') && t.state === 'open' && !t.assignee) {
            await startRunIfNeeded(payload, ticket, stage)
          }
        }
        if (next !== (src.cursor ?? null)) {
          await payload.update({ collection: 'ticket_sources', id: src.id, data: { cursor: next }, overrideAccess: true })
        }
      } catch (e) {
        payload.logger.error({ err: e, source: src.id }, 'poll-tickets failed for source')
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
      return { output: { status: r.status } }
    } catch (e) {
      await payload.update({
        collection: 'runs',
        id: run.id,
        data: { status: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: new Date().toISOString() },
        ...opts,
      })
      throw e
    }
  },
}
