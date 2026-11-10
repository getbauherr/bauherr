import { sql } from '@payloadcms/db-postgres'
import { budgetStatus, gatewayEnabled, shareOf } from '../../../lib/gateway'
import { PRESETS, presetOf } from '../../../lib/providers'
import { payloadClient } from './session'

const o = { overrideAccess: true, depth: 0 } as const

export type Bar = { label: string; spent: number | null; limit: number }
export type CostRow = { label: string; costUsd: number; estimate: boolean; unpriced: number; number?: number; id?: number }
export type Usage = {
  unit: 'usd' | 'tokens'
  /** One bar for the Workspace key, or Direct + Auto while a router Connection exists. */
  bars: Bar[]
  providers: { name: string; preset: string; secret: 'set' | 'not set' | 'not needed' }[]
  tiers: { tier: string; model: string }[]
  costs: { product: CostRow[]; ticket: CostRow[]; stage: CostRow[] }
}

const TIERS = ['cheap', 'standard', 'strong'] as const

/** Everything the AI usage page shows; secrets only ever reach this function as a boolean. */
export async function loadUsage(workspace: number): Promise<Usage> {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, select: { gatewayKey: false }, ...o } as never)) as unknown as Record<string, any>
  const tokens = ws.budgetUnit === 'tokens'
  const base = (tokens ? ws.budgetTokens30d : ws.budgetUsd30d) ?? 0
  const share = (ws.routerBudgetShare ?? 20) as number

  const conns = (await payload.find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', pagination: false, select: { name: true, config: true, secret: true }, ...o } as never)).docs as unknown as Record<string, any>[]
  const providers = conns.map((c) => {
    const preset = presetOf(c.config)
    return { name: c.name as string, preset, secret: PRESETS[preset].auth === 'ambient' ? ('not needed' as const) : c.secret ? ('set' as const) : ('not set' as const) }
  })
  const set = (ws.modelByTier ?? {}) as Record<string, string>
  const tiers = TIERS.map((tier) => ({ tier, model: set[tier] ?? '' }))

  const rows = (await payload.db.drizzle.execute(sql`
    WITH c AS (
      SELECT r.stage::text AS stage, t.id AS ticket_id, t.number, p.name::text AS product, t.title::text AS title,
             (CASE WHEN r.reconcile_status::text = 'unpriced' THEN 0 ELSE COALESCE(r.gateway_cost_usd, r.cost_estimate_usd, 0) END)::float AS cost,
             (r.reconcile_status::text = 'unpriced')::int AS unpriced,
             (COALESCE(r.tokens_in, 0) + COALESCE(r.tokens_out, 0))::float AS tokens,
             COALESCE(r.reconcile_status::text, 'pending') = 'pending' AS estimate
      FROM runs r JOIN tickets t ON t.id = r.ticket_id JOIN products p ON p.id = t.product_id
      WHERE r.workspace_id = ${workspace} AND r.created_at > now() - interval '30 days'
    )
    SELECT 'product' AS k, product AS label, NULL::int AS id, NULL::int AS number, SUM(cost)::float AS cost, bool_or(estimate) AS estimate, SUM(unpriced)::int AS unpriced FROM c GROUP BY product
    UNION ALL
    SELECT 'stage', stage, NULL, NULL, SUM(cost)::float, bool_or(estimate), SUM(unpriced)::int FROM c GROUP BY stage
    UNION ALL
    SELECT 'tokens', NULL, NULL, NULL, COALESCE(SUM(tokens), 0)::float, false, 0 FROM c
    UNION ALL
    (SELECT 'ticket', title, ticket_id, number::int, SUM(cost)::float, bool_or(estimate), SUM(unpriced)::int FROM c GROUP BY ticket_id, title, number ORDER BY SUM(cost) DESC, ticket_id LIMIT 20)
  `)).rows as { k: 'product' | 'stage' | 'ticket' | 'tokens'; label: string; id: number | null; number: number | null; cost: number; estimate: boolean; unpriced: number }[]
  const usd = tokens || !(gatewayEnabled() && process.env.GATEWAY_DATABASE_URL) ? null : (await budgetStatus(ws.slug).catch(() => null))?.spentUsd ?? null
  const spent = tokens ? rows.find((r) => r.k === 'tokens')?.cost ?? 0 : usd
  const bars: Bar[] = ws.routerKey
    ? [{ label: 'Total', spent, limit: base }, { label: 'Direct', spent: null, limit: shareOf(base, tokens, 100 - share) }, { label: 'Auto', spent: null, limit: shareOf(base, tokens, share) }]
    : [{ label: 'Workspace', spent, limit: base }]
  const of = (k: string): CostRow[] => rows.filter((r) => r.k === k).sort((a, b) => b.cost - a.cost).map((r) => ({ label: r.label, costUsd: r.cost, estimate: r.estimate, unpriced: r.unpriced, ...(r.id != null && { id: r.id, number: r.number ?? undefined }) }))
  return { unit: tokens ? 'tokens' : 'usd', bars, providers, tiers, costs: { product: of('product'), ticket: of('ticket'), stage: of('stage') } }
}
