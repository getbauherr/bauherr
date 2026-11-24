import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { connectionInput } from '../../lib/connection'
import { readerFor } from '../forge/reader'
import { loadProductRow } from '../forge/write-store'
import { list } from '../views/sql'

const id = z.coerce.number()
export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']
const FILE_LIMIT = 4000
const NOTE_LIMIT = 300
const KINDS = [
  'result.sent-back',
  'verify.changes',
  'question.asked',
  'question.answered',
  'run.failed',
  'owner.note',
  'brief.changes-requested',
]

export type TicketNote = { recordId: number; type: string; note: string }

const ids = (recordIds: number[]) => sql.join(recordIds.map((record) => sql`${record}`), sql`, `)

export const ticketTitles = async (payload: Payload, recordIds: number[]): Promise<Map<number, string>> => {
  if (recordIds.length === 0) return new Map()
  const found = await payload.db.drizzle.execute(sql`
    SELECT r."id", i."title" FROM "records" r
    JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = r."source_number"
    WHERE r."id" IN (${ids(recordIds)})`)
  return new Map(found.rows.map((row) => [id.parse(row.id), z.string().parse(row.title)]))
}

export const runCount = async (payload: Payload, recordIds: number[]): Promise<number> => {
  if (recordIds.length === 0) return 0
  const found = await payload.db.drizzle.execute(
    sql`SELECT count(*) AS n FROM "stage_runs" WHERE "record_id" IN (${ids(recordIds)})`,
  )
  return id.parse(found.rows[0]?.n)
}

const noteOf = (data: unknown): string => {
  const raw = z.record(z.string(), z.unknown()).safeParse(data)
  if (!raw.success) return ''
  const values = ['note', 'reason', 'text', 'option'].map((key) => raw.data[key]).filter((v) => typeof v === 'string')
  return values.join(' | ').slice(0, NOTE_LIMIT)
}

export const ticketNotes = async (payload: Payload, recordIds: number[]): Promise<TicketNote[]> => {
  if (recordIds.length === 0) return []
  const found = await payload.db.drizzle.execute(sql`
    SELECT "record_id", "type", "data" FROM "events"
    WHERE "record_id" IN (${ids(recordIds)}) AND "type" IN (${list(KINDS)}) ORDER BY "id"`)
  return found.rows.map((row) => ({
    recordId: id.parse(row.record_id),
    type: z.string().parse(row.type),
    note: noteOf(row.data),
  }))
}

export const instructionFiles = async (
  payload: Payload,
  target: { workspace: number; product: number },
): Promise<Record<string, string>> => {
  const files: Record<string, string> = {}
  try {
    const row = await loadProductRow(payload, target)
    const forge = readerFor(await connectionInput(payload, row.connection)).forge
    for (const path of INSTRUCTION_FILES) {
      const file = await forge.getFile(row.repo, path).catch(() => null)
      if (file) files[path] = file.content.slice(0, FILE_LIMIT)
    }
  } catch {
    return files
  }
  return files
}
