import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { inLockedRecord } from '../conn'
import { advance, type AdvanceDeps } from '../engine'
import type { State } from '../fold'
import type { ForgeWriter } from '../forge/writer'
import { fold, foldOptions } from '../lifecycle'
import { appendEvent, readEvents } from '../record/store'
import { DAY_MS } from './candidates'
import { questionPostedAt } from './posted'

export const REMINDER =
  'We are still waiting for your answer to the questions above. Reply here when you can; ' +
  'the ticket stays open until then.'

export type ReporterTiming = { remindDays: number; silentDays: number }
export type Due = 'remind' | 'silent' | null

export const reporterDue = (state: State, postedAt: string | null, now: Date, timing: ReporterTiming): Due => {
  if (!state.reporter.waiting || postedAt === null) return null
  const days = (now.getTime() - Date.parse(postedAt)) / DAY_MS
  if (days >= timing.silentDays) return 'silent'
  return days >= timing.remindDays && !state.reporter.reminded ? 'remind' : null
}

const rowSchema = z.object({
  id: z.coerce.number(),
  remind: z.coerce.number().nullable(),
  silent: z.coerce.number().nullable(),
})

const waiting = async (payload: Payload): Promise<{ id: number; timing: ReporterTiming }[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."id", p."reporter_remind_days" AS remind, p."reporter_silent_days" AS silent FROM "records" r
    JOIN "products" p ON p."id" = r."product_id" WHERE r."waiting_on" = 'reporter'`)
  return result.rows.map((row) => {
    const parsed = rowSchema.parse(row)
    return { id: parsed.id, timing: { remindDays: parsed.remind ?? 7, silentDays: parsed.silent ?? 21 } }
  })
}

const settle = (deps: AdvanceDeps, id: number, timing: ReporterTiming): Promise<Due> =>
  inLockedRecord(deps.payload, id, async (tx) => {
    const events = await readEvents(tx, id)
    const state = fold(events, foldOptions(await deps.configFor(id)))
    const due = reporterDue(state, questionPostedAt(events), deps.now, timing)
    if (due === null) return null
    const type = due === 'silent' ? 'reporter.silent' : 'reporter.reminded'
    await appendEvent(tx, id, { type, data: {}, actor: 'factory' })
    return due
  })

const itemOf = async (payload: Payload, recordId: number): Promise<number | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."id" FROM "records" r JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id"
      AND i."repo" = r."source_repo" AND i."number" = r."source_number" AND i."kind" = 'issue'
    WHERE r."id" = ${recordId}`)
  return result.rows[0] ? z.object({ id: z.coerce.number() }).parse(result.rows[0]).id : null
}

export const remindReporters = async (deps: AdvanceDeps, writer: Pick<ForgeWriter, 'postQuestion'>): Promise<void> => {
  for (const { id, timing } of await waiting(deps.payload)) {
    const due = await settle(deps, id, timing)
    if (due === 'remind') {
      const itemId = await itemOf(deps.payload, id)
      if (itemId !== null) await writer.postQuestion({ recordId: id, itemId }, REMINDER).catch(() => undefined)
    }
    if (due === 'silent') await advance(id, deps)
  }
}
