import type { Payload } from 'payload'
import { doneTickets } from '../views/time-load'
import type { TicketTime } from '../views/time-split'
import { NOT_STARTED_AFTER_MS } from './not-started'

export const HELD_UP_DAYS = 30

export type Held = { tickets: number; seconds: number }
export type HeldUp = { tickets: number; seconds: number; checks: Held; queued: Held }

const checksSeconds = (time: TicketTime): number =>
  time.stays
    .filter((stay) => stay.stage === 'verify' && stay.split.ci * 1000 > NOT_STARTED_AFTER_MS)
    .reduce((sum, stay) => sum + stay.split.ci, 0)

const queuedSeconds = (time: TicketTime): number => time.stays.reduce((sum, stay) => sum + stay.split.queued, 0)

const held = (seconds: number[]): Held => ({
  tickets: seconds.filter((value) => value > 0).length,
  seconds: seconds.reduce((sum, value) => sum + value, 0),
})

export const heldUp = (times: TicketTime[]): HeldUp => {
  const checks = times.map(checksSeconds)
  const queued = times.map(queuedSeconds)
  const both = checks.map((value, index) => value + (queued[index] ?? 0))
  return { ...held(both), checks: held(checks), queued: held(queued) }
}

export const loadHeldUp = async (
  payload: Payload,
  f: { workspace: number; product: number; now: Date },
): Promise<HeldUp> => {
  const tickets = await doneTickets(payload, { ...f, days: HELD_UP_DAYS })
  return heldUp(tickets.map((ticket) => ticket.time))
}
