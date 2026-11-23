import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from '../conn'

export type Shot = { id: number; kind: 'before' | 'after'; screen: string; width: number; sha: string }
export type Pair = { screen: string; before: Shot | null; after: Shot | null }

export const screenOf = (caption: string): string => (caption.split(' (')[0] ?? caption).trim()

const shotRow = z.object({
  id: z.coerce.number(),
  kind: z.enum(['before', 'after']),
  screen: z.string(),
  width: z.coerce.number(),
  proof_sha: z.string(),
})

export const loadShots = async (db: Conn, recordId: number): Promise<Shot[]> => {
  const found = await db.db.drizzle.execute(sql`
    SELECT "id", "kind", "screen", "width", "proof_sha" FROM "attachments"
    WHERE "record_id" = ${recordId} AND "kind" IN ('before', 'after') AND "content" IS NOT NULL ORDER BY "id"`)
  return found.rows.map((row) => {
    const { proof_sha: sha, ...rest } = shotRow.parse(row)
    return { ...rest, sha }
  })
}

export const pairsOf = (screens: string[], shots: Shot[]): Pair[] =>
  screens.map((screen) => {
    const latest = (kind: Shot['kind']) =>
      shots.findLast((shot) => shot.screen === screen && shot.kind === kind) ?? null
    return { screen, before: latest('before'), after: latest('after') }
  })

const quoted = (screen: string): string => `"${screen}"`

const problemOf = ({ screen, before, after }: Pair, headSha: string): string | null => {
  const name = `Screen ${quoted(screen)}`
  const how = (kind: string) => `attach it with kind ${kind} and screen ${quoted(screen)}`
  if (!before && !after) {
    return `${name} has no before and no after picture: take both at the same width, and ${how('before or after')}.`
  }
  if (!before) {
    return `${name} has no before picture: take it on the base commit, at width ${after?.width}, and ${how('before')}.`
  }
  if (!after) {
    return `${name} has no after picture: take it on the head, at width ${before.width}, and ${how('after')}.`
  }
  if (before.width !== after.width) {
    return `${name}: before is ${before.width} wide and after is ${after.width} wide: take both at the same width.`
  }
  if (after.sha !== headSha) {
    return `${name}: the after picture is not of the pull request head: take it again on the head and attach it.`
  }
  return null
}

export const pairProblems = (pairs: Pair[], headSha: string): { screen: string; message: string }[] =>
  pairs.flatMap((pair) => {
    const message = problemOf(pair, headSha)
    return message === null ? [] : [{ screen: pair.screen, message }]
  })
