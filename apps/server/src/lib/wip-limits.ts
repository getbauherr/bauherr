export const WIP_STAGES = ['plan', 'build', 'review', 'release'] as const
export type WipStage = (typeof WIP_STAGES)[number]
export type WipLimits = Partial<Record<WipStage, number>>

export const DEFAULT_WIP_LIMITS: Record<WipStage, number> = { plan: 3, build: 2, review: 3, release: 5 }

/** Why `v` is not a WIP limit map (only the four columns, positive integers; a missing key means no limit), or null. */
export const wipLimitsError = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return 'must be an object of column limits'
  for (const [k, n] of Object.entries(v)) {
    if (!(WIP_STAGES as readonly string[]).includes(k)) return `unknown column ${k}`
    if (n != null && !(Number.isInteger(n) && (n as number) > 0)) return `${k}: a whole number of at least 1, or empty for no limit`
  }
  return null
}

export const wipLimit = (ws: { wipLimits?: unknown } | null | undefined, stage: string): number | null => {
  const n = (ws?.wipLimits as WipLimits | null | undefined)?.[stage as WipStage]
  return typeof n === 'number' && n > 0 ? n : null
}

const label = (s: string) => s[0].toUpperCase() + s.slice(1)

/** "Waiting: Build is full (2/2)", or "Waiting: overlaps #12" when the Ticket carries a reason. */
export const waitingText = (stage: string, count: number, limit: number | null, reason?: string | null): string => (stage === 'checks' ? 'Waiting for checks' : reason ? `Waiting: ${reason}` : `Waiting: ${label(stage)} is full (${count}/${limit ?? count})`)
