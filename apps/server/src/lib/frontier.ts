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

export type FrontierTicket = { id: number | string; number: number; stage?: string | null; rank?: string | null; blocked?: boolean; reviewRounds?: number | null }
export type FrontierRun = { stage: string; status: string; mode?: string; previousRun?: unknown }

/** In flight: review/release, a latest Run that needs a human, or a Build Ticket the factory review sent back (`reviewRounds` > 0). */
const inFlight = (t: FrontierTicket, r?: FrontierRun): boolean =>
  t.stage === 'review' || t.stage === 'release' || r?.status === 'needs_human' || (t.stage === 'build' && (t.reviewRounds ?? 0) > 0)

const rankOf = (t: FrontierTicket, r?: FrontierRun): number => (t.blocked || (r?.status === 'running' && r.mode === 'session') ? 2 : inFlight(t, r) ? 0 : 1)

/** In flight first, then by rank, then by number; blocked and leased Tickets last. Pure; `latest` maps Ticket id to its latest Run. */
export const frontierOrder = <T extends FrontierTicket>(tickets: T[], latest: Map<T['id'], FrontierRun>): T[] =>
  tickets
    .map((t) => ({ t, g: rankOf(t, latest.get(t.id)) }))
    .sort((x, y) => x.g - y.g || cmp(x.t.rank, y.t.rank) || x.t.number - y.t.number)
    .map((x) => x.t)

const cmp = (a?: string | null, b?: string | null): number => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0)
