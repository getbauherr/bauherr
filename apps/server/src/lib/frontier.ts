const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const digit = (s: string, i: number): number => (i < s.length ? ALPHABET.indexOf(s[i]) : 0)

export class NoRoom extends Error {}

/** A key strictly between `a` and `b` (base-62 fractional index, ASCII order); `null` bounds are open. Throws `NoRoom` when `b` is `a` plus trailing zeros: no key exists between them. */
export const rankBetween = (a: string | null, b: string | null): string => {
  const lo = a ?? ''
  if (b !== null && lo >= b) throw new Error(`rank bounds out of order: ${a} >= ${b}`)
  let out = ''
  let tight = b !== null
  for (let i = 0; ; i++) {
    if (tight && i >= b!.length) throw new NoRoom(`no rank between ${a} and ${b}`)
    const l = digit(lo, i)
    const h = tight ? digit(b!, i) : ALPHABET.length
    if (h - l > 1) return out + ALPHABET[(l + h) >> 1]
    out += ALPHABET[l]
    if (h > l) tight = false
  }
}

export type FrontierTicket = { id: number | string; number: number; stage?: string | null; rank?: string | null; blocked?: boolean; expediting?: boolean; reviewRounds?: number | null }
export type FrontierRun = { stage: string; status: string; mode?: string; previousRun?: unknown }

/** Expedite first, then right to left (release, review, build, plan, triage), then the owner's rank, then number; blocked and leased Tickets last. Pure; `latest` maps Ticket id to its latest Run. */
export const frontierOrder = <T extends FrontierTicket>(tickets: T[], latest: Map<T['id'], FrontierRun>): T[] => {
  const parked = (t: T) => t.blocked || (latest.get(t.id)?.status === 'running' && latest.get(t.id)?.mode === 'session')
  return [...tickets].sort((a, b) => Number(!!parked(a)) - Number(!!parked(b)) || executionOrder(a, b))
}

/** Code-unit order: the single JS rank rule. SQL on `rank` must use `COLLATE "C"`. */
export const cmp = (a?: string | null, b?: string | null): number => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0)

const EXECUTION_STAGES = ['release', 'review', 'build', 'plan', 'triage']

/** Execution-order group of a stage: release 0, review 1, build 2, plan 3, triage 4, anything else 5. */
export const stageGroup = (stage?: string | null): number => {
  const i = EXECUTION_STAGES.indexOf(stage ?? '')
  return i < 0 ? EXECUTION_STAGES.length : i
}

/** Comparator for the order work is done in: Tickets served by the expedite lane first, then stage group, the owner's rank, number. */
export const executionOrder = (a: FrontierTicket, b: FrontierTicket): number => Number(!!b.expediting) - Number(!!a.expediting) || stageGroup(a.stage) - stageGroup(b.stage) || cmp(a.rank, b.rank) || a.number - b.number
