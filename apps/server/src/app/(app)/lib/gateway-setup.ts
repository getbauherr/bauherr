import type { Payload } from 'payload'
import { loadPriceStatus, pricesEnabled, type PriceStatus } from '../../../lib/prices'
import type { GatewayHealth } from '../../../lib/gateway-health'

const gatewayOn = (): boolean => !!process.env.GATEWAY_ADMIN_URL

export const loadGatewayHealth = async (payload: Payload): Promise<GatewayHealth | null> =>
  gatewayOn()
    ? (((
        await payload.find({
          collection: 'instance_state',
          where: { key: { equals: 'gateway' } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
      ).docs[0]?.value as GatewayHealth | undefined) ?? null)
    : null

export type GatewayStatus = { on: boolean; up: boolean | null; message: string | null; checkedAt: string | null }

const upOf = (h: GatewayHealth | null): boolean | null =>
  h ? h.up && Date.now() - Date.parse(h.checkedAt) < 5 * 60_000 : null

const messageOf = (h: GatewayHealth | null): string | null =>
  h?.message ?? (h ? null : 'The gateway has not been checked yet; the first check runs within a minute.')

export const loadGatewayStatus = async (payload: Payload): Promise<GatewayStatus> => {
  const on = gatewayOn()
  const h = on ? await loadGatewayHealth(payload) : null
  return {
    on,
    up: on ? upOf(h) : false,
    message: on ? messageOf(h) : 'The gateway is off on this instance (GATEWAY_ADMIN_URL is not set).',
    checkedAt: h?.checkedAt ?? null,
  }
}

export type Prices = { enabled: boolean; status: PriceStatus | null }
export const loadPrices = async (payload: Payload): Promise<Prices> => ({
  enabled: pricesEnabled(),
  status: await loadPriceStatus(payload),
})
