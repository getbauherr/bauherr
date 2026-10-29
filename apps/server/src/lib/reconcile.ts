import pg from 'pg'
import type { Payload } from 'payload'

export const RECONCILE_DELAY_MS = 5 * 60_000
export const RECONCILE_RETRY_MS = 10 * 60_000
const TOLERANCE = 0.1

export const retentionDays = (): number => Number(process.env.BAUHERR_REQUEST_LOG_RETENTION_DAYS) || 180

/** Runs `fn` against the gateway database (`request_logs`). */
const withGateway = async <T>(fn: (db: pg.Client) => Promise<T>): Promise<T> => {
  const db = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}

export const gatewayDbEnabled = (): boolean => !!process.env.GATEWAY_DATABASE_URL

/** Queues `reconcile-costs` for a finished Run, `delayMs` from now, on the `poll` queue. */
export const queueReconcile = (payload: Payload, runId: number | string, attempt = 1, delayMs = RECONCILE_DELAY_MS) =>
  payload.jobs.queue({
    task: 'reconcile-costs',
    queue: 'poll',
    input: { runId: Number(runId), attempt },
    waitUntil: new Date(Date.now() + delayMs),
  })

/**
 * Sums the gateway `request_logs` of a Run and writes the money fields. Gateway cost wins; a delta above 10 % of it is flagged `mismatch`.
 * No rows: `pending` and one retry on attempt 1, `unavailable` (cost stays `sdk-estimate`) on attempt 2.
 */
export const reconcileRun = async (payload: Payload, runId: number | string, attempt: number): Promise<string> => {
  const o = { overrideAccess: true, depth: 0 } as const
  const row = await withGateway(async (db) =>
    (
      await db.query(
        `SELECT count(*)::int AS n, COALESCE(sum(cost), 0) AS cost, COALESCE(sum(input_tokens), 0) AS tin,
                COALESCE(sum(output_tokens), 0) AS tout, COALESCE(sum(total_tokens), 0) AS ttotal
         FROM request_logs WHERE attributes_json->>'run' = $1`,
        [String(runId)],
      )
    ).rows[0],
  )
  if (!row.n) {
    if (attempt < 2) {
      await queueReconcile(payload, runId, 2, RECONCILE_RETRY_MS)
      return 'pending'
    }
    await payload.update({ collection: 'runs', id: runId, data: { reconcileStatus: 'unavailable' }, ...o })
    return 'unavailable'
  }
  const run = await payload.findByID({ collection: 'runs', id: runId, ...o })
  const gateway = Number(row.cost)
  const reconcileStatus = Math.abs(gateway - (run.costEstimateUsd ?? 0)) <= TOLERANCE * gateway ? 'matched' : 'mismatch'
  await payload.update({
    collection: 'runs',
    id: runId,
    data: {
      gatewayCostUsd: gateway,
      gatewayTokensIn: Number(row.tin),
      gatewayTokensOut: Number(row.tout),
      gatewayTokensTotal: Number(row.ttotal),
      costSource: 'gateway',
      reconcileStatus,
    },
    ...o,
  })
  return reconcileStatus
}

/** Deletes gateway `request_logs` older than the retention window; returns the count. */
export const pruneRequestLogs = (days = retentionDays()): Promise<number> =>
  withGateway(async (db) => (await db.query(`DELETE FROM request_logs WHERE started_at < now() - make_interval(days => $1)`, [days])).rowCount ?? 0)
