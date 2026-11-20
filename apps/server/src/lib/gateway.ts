import type { Payload, PayloadRequest } from 'payload'
import { decrypt } from './secrets'

export {
  budgetStatus,
  deleteKey,
  ensureKey,
  ensureSessionKey,
  newKey,
  rotateKey,
  rotateSessionKey,
} from './gateway-admin'
export {
  ensureManaged,
  KEY_LOCATION,
  renderModels,
  SESSION_LOG_FIELDS,
  syncManagedConfig,
  withConfig,
} from './gateway-config'
export { providerFile, removeProvider, removeWorkspaceProviders, writeProvider, writeSecretFile } from './gateway-files'

export const DEFAULT_MODEL_BY_TIER = {
  cheap: 'claude-haiku-5-5',
  standard: 'claude-sonnet-5-5',
  strong: 'claude-opus-5-5',
}

export const gatewayPublicUrl = (): string =>
  (process.env.GATEWAY_PUBLIC_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || 4000}`).replace(/\/+$/, '')

export const gatewayEnabled = (): boolean => {
  if (process.env.GATEWAY_ADMIN_URL) return true
  console.info('gateway: GATEWAY_ADMIN_URL unset, skipping')
  return false
}

export const tierModels = async (
  payload: Payload,
  ws: Record<string, unknown> & { id: number | string },
  req?: PayloadRequest,
): Promise<Record<string, string>> => {
  const slug = String(ws.slug)
  const set = (ws.modelByTier ?? {}) as Record<string, string>
  const conns = (
    await payload.find({
      collection: 'connections',
      where: { workspace: { equals: ws.id }, kind: { equals: 'llm-provider' } },
      sort: 'id',
      select: { provider: true, slug: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      ...(req ? { req } : {}),
    })
  ).docs as { slug: string }[]
  const first = Object.keys(DEFAULT_MODEL_BY_TIER).some((t) => !set[t]) ? conns[0] : undefined
  return Object.fromEntries(
    Object.entries(DEFAULT_MODEL_BY_TIER).map(([t, def]) => {
      if (set[t]) return [t, `ws-${slug}/${set[t]}`]
      if (!first) throw new Error(`Workspace ${slug} has no LLM provider Connection for tier "${t}"`)
      return [t, `ws-${slug}/${first.slug}/${def}`]
    }),
  )
}

export const completeCheap = async (
  w: { slug: string; gatewayKey: string; modelByTier?: Partial<typeof DEFAULT_MODEL_BY_TIER> | null },
  system: string,
  user: string,
): Promise<string> => {
  const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${decrypt(w.gatewayKey)}` },
    body: JSON.stringify({
      model: `ws-${w.slug}/${{ ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }.cheap}`,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`gateway completion failed: HTTP ${res.status}`)
  return (
    ((await res.json()) as { content: { type: string; text?: string }[] }).content.find((c) => c.type === 'text')
      ?.text ?? ''
  )
}

export const verifyProvider = async (
  slug: string,
  key: string,
  model: string,
): Promise<{ verifiedAt: string } | { lastError: string }> => {
  let last = 'network error'
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: `ws-${slug}/${model}`,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ok' }],
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { verifiedAt: new Date().toISOString() }
      last = `HTTP ${res.status}`
    } catch {}
  }
  return { lastError: last }
}
