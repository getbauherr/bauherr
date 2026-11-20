import pg from 'pg'
import type { Payload } from 'payload'
import { setState } from './prices'

export type GatewayHealth = { checkedAt: string; up: boolean; message: string | null; migration: number | null }
export const KNOWN_REQUEST_LOG_MIGRATION = 3

export const checkGateway = async (payload: Payload, now = Date.now()): Promise<GatewayHealth> => {
  let migration: number | null = null
  try {
    const client = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
    await client.connect()
    try {
      const result = await client.query<{ v: unknown }>(
        `SELECT max(version) AS v FROM _agentgateway_request_log_migrations`,
      )
      migration = Number(result.rows[0]?.v ?? 0) || null
    } finally {
      await client.end()
    }
  } catch {}
  const up = await fetch(`${process.env.GATEWAY_URL}/v1/models`, { signal: AbortSignal.timeout(3000) }).then(
    () => true,
    () => false,
  )
  const ahead = migration != null && migration > KNOWN_REQUEST_LOG_MIGRATION
  const message = up
    ? null
    : ahead
      ? `The gateway is not running and its database is newer (migration ${migration}) ` +
        `than this image knows (${KNOWN_REQUEST_LOG_MIGRATION}). ` +
        'Never downgrade the gateway image: start the version you ran before, or a newer one.'
      : 'The gateway does not answer. Check `docker compose logs gateway`.'
  const health: GatewayHealth = { checkedAt: new Date(now).toISOString(), up, message, migration }
  await setState(payload, 'gateway', health)
  return health
}
