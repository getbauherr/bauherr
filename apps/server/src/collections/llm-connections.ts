import type { PayloadRequest } from 'payload'
import { PRESETS, presetOf, type Preset } from '../lib/providers'

export const TIERS = ['cheap', 'standard', 'strong'] as const
export const sharedIdentity = (p: Preset) => PRESETS[p].auth === 'ambient'

export type LlmConnection = { id: number | string; slug?: string; config?: { provider?: string } | null }

export const llmConnections = async (req: PayloadRequest, workspace: number | string): Promise<LlmConnection[]> =>
  (
    await req.payload.find({
      collection: 'connections',
      where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } },
      sort: 'id',
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
  ).docs

export const unitOf = (conns: LlmConnection[]) =>
  conns.every((c) => PRESETS[presetOf(c.config)].catalog) ? 'usd' : 'tokens'
