import { setStage, type TicketSource } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

const idOf = (v: unknown) => (typeof v === 'object' && v ? (v as { id: number }).id : (v as number))

/** Forward order of the stage labels; unknown names are never "forward". */
const ORDER = ['triage', 'plan', 'parent', 'build', 'review', 'release', 'done']
export const isForward = (from: string, to: string) => ORDER.includes(from) && ORDER.includes(to) && ORDER.indexOf(to) > ORDER.indexOf(from)

/** The factory's own stage move: records it on the Ticket row first, so the poller can tell it from a hand-set forge label (#196), then sets the label. */
export const moveStage = async (payload: Payload, ts: TicketSource, t: Record<string, any>, name: string): Promise<void> => {
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "factory_stage" = ${name} WHERE "product_id" = ${idOf(t.product)} AND "number" = ${t.number}`)
  await setStage(ts, String(t.number), name)
}
