import type { Payload } from 'payload'
import type { TrainState } from '../../../lib/train'

type Doc = Record<string, any>
export type StripTicket = { id: number | string; number: number; reviewState: string | null; trainFailures: number }

/** The one-line merge state of a Product on `/releases`: how its changes get merged, who waits in the queue or train and what is being built, and who was dropped back to Build. */
export const mergeStrip = (mode: string, train: Pick<TrainState, 'members' | 'phase'> | null, tickets: StripTicket[]): string => {
  const queued = tickets.filter((t) => t.reviewState === 'queued')
  const byId = new Map(tickets.map((t) => [String(t.id), t.number]))
  const building = (train?.members ?? []).map((m) => `#${byId.get(String(m.ticket)) ?? m.ticket}`)
  const dropped = tickets.filter((t) => t.trainFailures > 0)
  const head = mode === 'train'
    ? `Merge train: ${queued.length} queued${building.length ? `, ${building.join(' ')} ${train?.phase === 'bisect' ? 'bisecting' : 'building'}` : ''}`
    : mode === 'queue'
      ? `Queue: ${queued.length} waiting`
      : 'Merges directly, no queue'
  return dropped.length ? `${head} · dropped back to Build: ${dropped.map((t) => `#${t.number} (${t.trainFailures}×)`).join(', ')}` : head
}

/** The inputs of `mergeStrip` for one Product from the database: its merge mode, running train and the open Tickets that are queued or were dropped. */
export const loadMergeStrip = async (payload: Payload, product: number): Promise<string> => {
  const o = { depth: 0, overrideAccess: true, pagination: false } as const
  const p = (await payload.findByID({ collection: 'products', id: product, select: { mergeMode: true, trainState: true }, ...o } as never)) as Doc
  const rows = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product } }, { state: { equals: 'open' } }, { or: [{ reviewState: { equals: 'queued' } }, { trainFailures: { greater_than: 0 } }] }] }, select: { number: true, reviewState: true, trainFailures: true }, sort: 'number', ...o } as never)).docs as Doc[]
  return mergeStrip(p.mergeMode ?? 'direct', p.trainState ?? null, rows.map((t) => ({ id: t.id, number: t.number, reviewState: t.reviewState ?? null, trainFailures: t.trainFailures ?? 0 })))
}
