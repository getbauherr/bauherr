import type { RangeInput } from '../../../core/insights/range'
import { shortDate } from './format'

export type RangeParams = { range?: string; tag?: string; from?: string; to?: string; since?: string }
export type RangeChoice = { range: RangeInput; label: string }

const DAY_MS = 86_400_000
const FALLBACK_DAYS = 30
const DATE = /^\d{4}-\d{2}-\d{2}$/

const day = (text: string | undefined): Date | null =>
  text && DATE.test(text) && !Number.isNaN(+new Date(text)) ? new Date(`${text}T00:00:00Z`) : null

export const rangeFromParams = (params: Record<string, string | undefined>, now = new Date()): RangeChoice | null => {
  if (params.range === 'tag' && params.tag) return { range: { tag: params.tag }, label: `Since ${params.tag}` }
  if (params.range === 'dates') {
    const from = day(params.from)
    const to = day(params.to)
    if (!from || !to || from >= to) return null
    return { range: { from, to }, label: `${shortDate(from.toISOString())} to ${shortDate(to.toISOString())}` }
  }
  const since = day(params.since) ?? new Date(now.getTime() - FALLBACK_DAYS * DAY_MS)
  return {
    range: { since },
    label: params.since ? 'Since the last Retro' : `Last ${FALLBACK_DAYS} days (no earlier Retro)`,
  }
}
