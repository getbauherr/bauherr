import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { reachOf, warningsOf, type Executor, type Reach, type Warning } from '../instruction-files'

export type InstructionFileRow = { repo: string; path: string; lines: number; reach: Reach; warnings: Warning[] }
export type InstructionFilesView = { read: boolean; multiRepo: boolean; files: InstructionFileRow[] }

const count = z.coerce.number()

const fileRow = z.object({ repo: z.string(), path: z.string(), lines: count, chars: count })
const stateRow = z.object({ executor: z.string().nullable(), read: z.boolean() })

export const instructionFilesOf = async (
  payload: Payload,
  workspace: number,
  product: number,
): Promise<InstructionFilesView> => {
  const state = await payload.db.drizzle.execute(sql`
    SELECT p."executor", EXISTS (
      SELECT 1 FROM "ticket_sources" s WHERE s."product_id" = p."id" AND s."facts_at" IS NOT NULL) AS "read"
    FROM "products" p WHERE p."id" = ${product} AND p."workspace_id" = ${workspace}`)
  const found = stateRow.safeParse(state.rows[0])
  if (!found.success) return { read: false, multiRepo: false, files: [] }
  const executor: Executor = found.data.executor === 'runner' ? 'runner' : 'session'
  const rows = await payload.db.drizzle.execute(sql`
    SELECT "repo", "path", "lines", "chars" FROM "repo_instruction_files"
    WHERE "workspace_id" = ${workspace} AND "product_id" = ${product}`)
  const files = rows.rows.map((raw) => {
    const row = fileRow.parse(raw)
    return {
      repo: row.repo,
      path: row.path,
      lines: row.lines,
      reach: reachOf(row.path, executor),
      warnings: warningsOf(row.path, row.lines, row.chars),
    }
  })
  const byPath = (a: InstructionFileRow, b: InstructionFileRow) =>
    a.repo === b.repo ? (a.path < b.path ? -1 : 1) : a.repo < b.repo ? -1 : 1
  return {
    read: found.data.read,
    multiRepo: new Set(files.map((file) => file.repo)).size > 1,
    files: files.sort(byPath),
  }
}
