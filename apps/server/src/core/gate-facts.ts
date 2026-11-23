import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { loadShots } from './attachments/pairs'
import type { Conn } from './conn'
import { fold } from './fold'
import type { GateFacts } from './gate'
import { foldOptions, type Config } from './lifecycle'
import { checksState } from './mirror/react'
import { readEvents, type StoredRecord } from './record/store'
import type { Run } from './run/schema'
import { loadMockups } from './views/attachments'

const rowOf = z.object({ id: z.coerce.number(), head_sha: z.string().nullable() })
const leasedOf = z.object({ leased_by: z.string().nullable() })
const checkOf = z.object({ status: z.string().nullable(), conclusion: z.string().nullable() })

const builder = async (tx: Conn, recordId: number): Promise<string | null> => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT "leased_by" FROM "stage_runs"
    WHERE "record_id" = ${recordId} AND "stage" = 'build' AND "status" = 'submitted' ORDER BY "id" DESC LIMIT 1`)
  return found.rows[0] ? leasedOf.parse(found.rows[0]).leased_by : null
}

const pullOf = async (tx: Conn, stored: StoredRecord, pr: number) => {
  const found = await tx.db.drizzle.execute(sql`
    SELECT "id", "head_sha" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${stored.record.source.repo} AND "number" = ${pr}
      AND "kind" = 'pr' AND "gone_at" IS NULL`)
  return found.rows[0] ? rowOf.parse(found.rows[0]) : null
}

const checksOf = async (tx: Conn, item: number, sha: string, required: boolean): Promise<GateFacts['checks']> => {
  if (!required) return 'none'
  const found = await tx.db.drizzle.execute(
    sql`SELECT "status", "conclusion" FROM "mirror_checks" WHERE "item_id" = ${item} AND "sha" = ${sha}`,
  )
  const checks = found.rows.map((row) => {
    const parsed = checkOf.parse(row)
    return { status: parsed.status ?? '', conclusion: parsed.conclusion }
  })
  return checksState(checks)
}

const proofsOf = async (tx: Conn, recordId: number): Promise<string[]> => {
  const found = await tx.db.drizzle.execute(sql`SELECT "id" FROM "proofs" WHERE "record_id" = ${recordId}`)
  return found.rows.map((row) => String(z.object({ id: z.coerce.number() }).parse(row).id))
}

export const loadGateFacts = async (tx: Conn, stored: StoredRecord, run: Run, config: Config): Promise<GateFacts> => {
  const state = fold(await readEvents(tx, stored.id), foldOptions(config))
  const patch = state.patch === null ? null : { id: state.patch.id, headSha: state.patch.headSha }
  const pull = state.patch === null ? null : await pullOf(tx, stored, state.patch.pr)
  const headCommit = pull?.head_sha ?? null
  return {
    buildClaimedBy: await builder(tx, stored.id),
    verifyHeldBy: run.leasedBy,
    patch,
    headCommit,
    checks: pull && headCommit ? await checksOf(tx, pull.id, headCommit, config.requiredChecks) : 'pending',
    proofIds: await proofsOf(tx, stored.id),
    screens: stored.record.visible ? (await loadMockups(tx, stored.id)).map((mockup) => mockup.screen) : [],
    shots: await loadShots(tx, stored.id),
  }
}
