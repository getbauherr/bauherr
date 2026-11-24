import pg from 'pg'
import { z } from 'zod'

export type GatewayRequest = {
  at: Date
  cost: number | null
  inputTokens: number
  outputTokens: number
  session: string | null
  run: string | null
}

export type RequestQuery = { user: string; sessions: string[]; runs: string[]; from: Date; to: Date }

const row = z.object({
  started_at: z.coerce.date(),
  cost: z.coerce.number().nullable(),
  input_tokens: z.coerce.number().nullable(),
  output_tokens: z.coerce.number().nullable(),
  session: z.string().nullable(),
  run: z.string().nullable(),
})

export const gatewayRequests = async (query: RequestQuery): Promise<GatewayRequest[]> => {
  if (query.sessions.length === 0 && query.runs.length === 0) return []
  const db = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
  await db.connect()
  try {
    const result = await db.query(
      `SELECT started_at, cost, input_tokens, output_tokens,
          attributes_json->>'agentgateway.session' AS session, attributes_json->>'run' AS run
        FROM request_logs
        WHERE agentgateway_user = $1 AND started_at >= $2 AND started_at <= $3 AND COALESCE(http_status, 200) < 400
          AND (attributes_json->>'agentgateway.session' = ANY($4::text[]) OR attributes_json->>'run' = ANY($5::text[]))
        ORDER BY started_at`,
      [query.user, query.from, query.to, query.sessions, query.runs],
    )
    return result.rows.map((raw) => {
      const found = row.parse(raw)
      return {
        at: found.started_at,
        cost: found.cost,
        inputTokens: found.input_tokens ?? 0,
        outputTokens: found.output_tokens ?? 0,
        session: found.session,
        run: found.run,
      }
    })
  } finally {
    await db.end()
  }
}
