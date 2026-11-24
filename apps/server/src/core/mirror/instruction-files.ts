import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { ReadForge } from '../forge/reader'

export const INSTRUCTION_FILE_LIMIT = 100

const PATTERNS = [
  /(^|\/)AGENTS\.md$/,
  /(^|\/)CLAUDE\.md$/,
  /^\.ai\/rules\/.+/,
  /^\.claude\/skills\/.+/,
  /^\.claude\/agents\/.+/,
  /^\.cursor\/rules\/.+/,
  /^\.github\/copilot-instructions\.md$/,
]

export const isInstructionPath = (path: string): boolean => PATTERNS.some((pattern) => pattern.test(path))

export type InstructionFile = { path: string; lines: number; chars: number }
export type InstructionFiles = { commit: string; files: InstructionFile[] }

const linesOf = (content: string): number => (content === '' ? 0 : content.replace(/\n$/, '').split('\n').length)

export const readInstructionFiles = async (
  repo: string,
  forge: ReadForge,
  listing: { commit: string; paths: string[] },
  ref: string,
): Promise<InstructionFiles> => {
  const files: InstructionFile[] = []
  for (const path of listing.paths.filter(isInstructionPath).sort().slice(0, INSTRUCTION_FILE_LIMIT)) {
    const { content } = await forge.getFile(repo, path, ref)
    files.push({ path, lines: linesOf(content), chars: content.length })
  }
  return { commit: listing.commit, files }
}

export const saveInstructionFiles = async (
  payload: Payload,
  source: { workspace: number; product: number },
  found: InstructionFiles,
  now: Date,
): Promise<void> => {
  const { workspace, product } = source
  await payload.db.drizzle.execute(
    sql`DELETE FROM "repo_instruction_files" WHERE "workspace_id" = ${workspace} AND "product_id" = ${product}`,
  )
  for (const file of found.files) {
    await payload.db.drizzle.execute(sql`
      INSERT INTO "repo_instruction_files"
        ("workspace_id", "product_id", "path", "lines", "chars", "commit", "synced_at")
      VALUES (${workspace}, ${product}, ${file.path}, ${file.lines}, ${file.chars}, ${found.commit},
        ${now.toISOString()}::timestamptz)`)
  }
}
