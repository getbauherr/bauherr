import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { gatewayPublicUrl, tierModels } from '../../../lib/gateway'
import { loadPriceStatus, pricesEnabled, type PriceStatus } from '../../../lib/prices'
import type { GatewayHealth } from '../../../lib/session-usage'
import type { GatewaySetup } from './harnesses'

const gatewayOn = (): boolean => !!process.env.GATEWAY_ADMIN_URL
/** The two lines that switch the gateway UI on (compose profile `gateway-ui`, docs/gateway.md, The gateway UI). */
export const UI_SWITCH_ON = 'COMPOSE_PROFILES=gateway-ui\nGATEWAY_UI_URL=http://127.0.0.1:15000/ui/'

/** The stored gateway health (written every minute by `watch-gateway`); null before the first check or when the gateway is off. DB only. */
export const loadGatewayHealth = async (payload: Payload): Promise<GatewayHealth | null> =>
  gatewayOn() ? ((await payload.find({ collection: 'instance_state', where: { key: { equals: 'gateway' } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]?.value as GatewayHealth | undefined) ?? null : null

/** `uiUrl`: where the gateway UI is reachable for this installation (`GATEWAY_UI_URL`, set next to the `gateway-ui` compose profile); empty while it is off. */
export type GatewayStatus = { on: boolean; up: boolean | null; message: string | null; checkedAt: string | null; uiUrl: string }

export const loadGatewayStatus = async (payload: Payload): Promise<GatewayStatus> => {
  const on = gatewayOn()
  const h = on ? await loadGatewayHealth(payload) : null
  return { on, up: on ? (h ? h.up && Date.now() - Date.parse(h.checkedAt) < 5 * 60_000 : null) : false, message: on ? (h?.message ?? (h ? null : 'The gateway has not been checked yet; the first check runs within a minute.')) : 'The gateway is off on this instance (GATEWAY_ADMIN_URL is not set).', checkedAt: h?.checkedAt ?? null, uiUrl: /^https?:\/\//.test(process.env.GATEWAY_UI_URL ?? '') ? process.env.GATEWAY_UI_URL! : '' }
}

/** Values for the setup block of one Workspace: addresses, the Workspace's tier models and the gateway status. Never a key. */
export const loadGatewaySetup = async (payload: Payload, workspace: { id: number; slug: string }, admin: boolean): Promise<GatewaySetup & { status: GatewayStatus }> => {
  const status = await loadGatewayStatus(payload)
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace.id, select: { slug: true, modelByTier: true }, depth: 0, overrideAccess: true })) as Record<string, any>
  const tiers = await tierModels(payload, { ...ws, id: workspace.id }).catch(() => null)
  return {
    gateway: gatewayPublicUrl(),
    mcp: `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/mcp`,
    workspace: workspace.slug,
    models: tiers?.cheap && tiers.standard && tiers.strong ? { cheap: tiers.cheap, standard: tiers.standard, strong: tiers.strong } : null,
    roll: randomBytes(2).toString('hex'),
    up: status.up,
    message: status.message,
    admin: admin && status.on,
    status,
  }
}

export type Prices = { enabled: boolean; status: PriceStatus | null }
export const loadPrices = async (payload: Payload): Promise<Prices> => ({ enabled: pricesEnabled(), status: await loadPriceStatus(payload) })
