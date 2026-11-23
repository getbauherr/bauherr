import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from './conn'
import { anyWord, queryWords, sharedWords } from './mirror/match'
import type { TicketRecord } from './record/schema'
import { readEvents, type StoredEvent } from './record/store'

export const CANDIDATES_MAX = 40

export type Correction = { id: string; kind: 'send-back' | 'brief-change'; note: string }
export type PackMemory = { id: number; text: string }
export type LearnPack = { corrections: Correction[]; handed: PackMemory[]; candidates: PackMemory[] }

const noted = (event: StoredEvent): Omit<Correction, 'id'>[] => {
  if (event.type === 'result.sent-back') return [{ kind: 'send-back', note: event.data.note }]
  if (event.type === 'brief.changes-requested') return [{ kind: 'brief-change', note: event.data.note }]
  return []
}

export const correctionsOf = (events: StoredEvent[]): Correction[] =>
  events.flatMap(noted).map((correction, at) => ({ id: `n${at + 1}`, ...correction }))

const memoryRow = z.object({ id: z.coerce.number(), text: z.string() })

const handedBy = async (tx: Conn, recordId: number): Promise<PackMemory[]> => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT DISTINCT s."id", s."text" FROM "stage_runs" r
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(r."context" -> 'statements', '[]'::jsonb)) AS ids
    JOIN "statements" s ON s."id" = ids.value::int
    WHERE r."record_id" = ${recordId} ORDER BY s."id"`)
  return found.rows.map((row) => memoryRow.parse(row))
}

const similarTo = async (tx: Conn, recordId: number, words: string[]): Promise<PackMemory[]> => {
  if (words.length === 0) return []
  const vector = sql`to_tsvector('simple', s."text")`
  const found = await tx.db.drizzle.execute(sql`
    SELECT s."id", s."text" FROM "statements" s JOIN "records" r ON r."id" = ${recordId}
    WHERE s."product_id" = r."product_id" AND NOT s."off" AND (s."record_id" = r."id" OR s."scope" = 'product')
      AND ${vector} @@ ${anyWord(words)}
    ORDER BY ${sharedWords(vector, words)} DESC, ts_rank(${vector}, ${anyWord(words)}) DESC, s."id" DESC
    LIMIT ${CANDIDATES_MAX}`)
  return found.rows.map((row) => memoryRow.parse(row))
}

export const learnPack = async (tx: Conn, recordId: number, record: TicketRecord): Promise<LearnPack> => {
  const corrections = correctionsOf(await readEvents(tx, recordId))
  const handed = await handedBy(tx, recordId)
  const text = [record.goal, ...record.findings.map((finding) => finding.text), ...corrections.map((c) => c.note)]
  const similar = await similarTo(tx, recordId, queryWords(text.join(' ')))
  return { corrections, handed, candidates: similar.filter((hit) => !handed.some((known) => known.id === hit.id)) }
}
