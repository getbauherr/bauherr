import { z } from 'zod'
import type { Role } from '../lifecycle'
import { DEFAULT_TIER, TIERS, type Tier } from './schema'

export const packTiers = z.object({
  roles: z.record(z.string(), z.object({ tier: z.enum(TIERS) })).default({}),
})

export const tierIn = (pack: unknown, role: Role): Tier => packTiers.parse(pack).roles[role]?.tier ?? DEFAULT_TIER
