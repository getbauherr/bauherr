import { z } from 'zod'
import { RANGES, type Range } from '../../../core/views/insights-page'
import type { Part } from '../../../core/views/time-split'
import type { CostKey } from '../../../core/views/cost-view'

export const DEFAULT_RANGE: Range = 30

const search = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).catch(DEFAULT_RANGE),
  product: z.coerce.number().int().positive().optional().catch(undefined),
})

export const parseInsights = (raw: { days?: string; product?: string }): { days: Range; product?: number } => {
  const parsed = search.parse(raw)
  return parsed.product === undefined ? { days: parsed.days } : { days: parsed.days, product: parsed.product }
}

export const insightsHref = (days: Range, product?: number | null): string => {
  const query = new URLSearchParams({ days: String(days) })
  if (product) query.set('product', String(product))
  return `/insights?${query.toString()}`
}

export const RANGE_LABELS: Record<Range, string> = Object.fromEntries(
  RANGES.map((days) => [days, `${days} days`]),
) as Record<Range, string>

export const PART_WORDS: Record<Part, string> = {
  agent: 'Agent working',
  you: 'Waiting on you',
  ci: 'Waiting on CI',
  queued: 'Queued, no agent',
}

export const PART_CLASSES: Record<Part, string> = {
  agent: 'bg-primary',
  you: 'bg-warn',
  ci: 'bg-muted-foreground',
  queued: 'bg-border',
}

export const COST_WORDS: Record<CostKey, string> = {
  intake: 'Intake',
  brief: 'Brief',
  build: 'Build',
  review: 'Review',
  verify: 'Verify',
  learn: 'Learn',
}

export const span = (seconds: number | null): string => {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} h`
  return `${(seconds / 86_400).toFixed(1)} d`
}

export const percent = (share: number | null): string => (share === null ? '—' : `${Math.round(share * 100)} %`)
export const rounds = (value: number | null): string => (value === null ? '—' : value.toFixed(1))
