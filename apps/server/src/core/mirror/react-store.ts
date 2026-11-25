import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from '../conn'
import { deploySince, type DeployCheck, type DeployWait } from '../deploy'
import type { State } from '../fold'
import { questionPostedAt } from '../intake/posted'
import { next, type Config } from '../lifecycle'
import type { StoredEvent, StoredRecord } from '../record/store'
import type { ReactCheck, ReactComment, ReactInput, ReactItem } from './react'

const count = z.coerce.number()
const idRow = z.object({ id: count })

const itemRow = z.object({
  id: count,
  state: z.enum(['open', 'closed', 'merged']),
  head_sha: z.string().nullable(),
  merge_sha: z.string().nullable(),
  base_ref: z.string().nullable(),
  conflict_sha: z.string().nullable(),
})

const commentRow = z.object({ author: z.string().nullable(), body: z.string().nullable(), at: z.coerce.date() })
const checkRow = z.object({ status: z.string().nullable(), conclusion: z.string().nullable() })
const deployCheckRow = z.object({
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  at: z.coerce.date(),
})

type Found = { id: number; item: ReactItem }

const findItem = async (conn: Conn, workspace: number, repo: string, number: number): Promise<Found | null> => {
  const result = await conn.db.drizzle.execute(sql`
    SELECT "id", "state", "head_sha", "merge_sha", "base_ref", "conflict_sha" FROM "mirror_items"
    WHERE "workspace_id" = ${workspace} AND "repo" = ${repo} AND "number" = ${number} AND "gone_at" IS NULL`)
  const row = result.rows[0] ? itemRow.parse(result.rows[0]) : null
  if (!row) return null
  const conflicts = row.conflict_sha !== null && row.conflict_sha === row.head_sha
  const item = { state: row.state, headSha: row.head_sha, mergeSha: row.merge_sha, baseRef: row.base_ref, conflicts }
  return { id: row.id, item }
}

const readComments = async (conn: Conn, item: number): Promise<ReactComment[]> => {
  const result = await conn.db.drizzle.execute(
    sql`SELECT "author", "body", "forge_created_at" AS at FROM "mirror_comments" WHERE "item_id" = ${item}`,
  )
  return result.rows.map((row) => {
    const parsed = commentRow.parse(row)
    return { author: parsed.author ?? '', body: parsed.body ?? '', createdAt: parsed.at.toISOString() }
  })
}

const readChecks = async (conn: Conn, item: number, sha: string): Promise<ReactCheck[]> => {
  const result = await conn.db.drizzle.execute(
    sql`SELECT "status", "conclusion" FROM "mirror_checks" WHERE "item_id" = ${item} AND "sha" = ${sha}`,
  )
  return result.rows.map((row) => {
    const parsed = checkRow.parse(row)
    return { status: parsed.status ?? '', conclusion: parsed.conclusion }
  })
}

const readDeployChecks = async (conn: Conn, item: number, sha: string): Promise<DeployCheck[]> => {
  const result = await conn.db.drizzle.execute(sql`
    SELECT "name", "status", "conclusion", "updated_at" AS at FROM "mirror_checks"
    WHERE "item_id" = ${item} AND "sha" = ${sha}`)
  return result.rows.map((row) => {
    const parsed = deployCheckRow.parse(row)
    return {
      name: parsed.name,
      status: parsed.status ?? '',
      conclusion: parsed.conclusion,
      updatedAt: parsed.at.toISOString(),
    }
  })
}

const loadDeployWait = async (
  conn: Conn,
  stored: StoredRecord,
  state: State,
  events: StoredEvent[],
  config: Config,
  now: Date,
): Promise<DeployWait | null> => {
  const step = next(stored.record, state, config)
  const since = deploySince(events)
  if (step.kind !== 'wait' || step.on !== 'deploy' || since === null || !state.patch || state.mergeSha === null) {
    return null
  }
  const { repo } = stored.record.source
  const pull = await findItem(conn, stored.workspace, repo, state.patch.pr)
  if (!pull) return null
  const checks = await readDeployChecks(conn, pull.id, state.mergeSha)
  return { names: config.deployNames, since, limitMinutes: config.deployWaitMinutes, now, checks }
}

const closeWritten = (events: StoredEvent[]): boolean => {
  const archived = events.findLastIndex((event) => event.type === 'ticket.closed')
  return events
    .slice(archived + 1)
    .some((event) => event.type === 'forge.write.done' && event.data.kind === 'close')
}

export const loadReactInput = async (
  conn: Conn,
  stored: StoredRecord,
  state: State,
  events: StoredEvent[],
  config: Config,
  now: Date,
): Promise<ReactInput | null> => {
  const { repo, number } = stored.record.source
  const issue = await findItem(conn, stored.workspace, repo, number)
  if (!issue) return null
  const pr = state.patch ? await findItem(conn, stored.workspace, repo, state.patch.pr) : null
  return {
    record: stored.record,
    state,
    postedAt: questionPostedAt(events),
    issue: issue.item,
    pull: pr?.item ?? null,
    comments: await readComments(conn, issue.id),
    checks: pr && state.patch ? await readChecks(conn, pr.id, state.patch.headSha) : [],
    deploy: await loadDeployWait(conn, stored, state, events, config, now),
    closeWritten: closeWritten(events),
  }
}

export const recordsOfItems = async (conn: Conn, items: number[]): Promise<number[]> => {
  if (items.length === 0) return []
  const result = await conn.db.drizzle.execute(sql`
    SELECT DISTINCT r."id" FROM "records" r
    JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
    WHERE i."id" IN (${sql.join(items.map((item) => sql`${item}`), sql`, `)})
      AND ((i."kind" = 'issue' AND i."number" = r."source_number")
        OR (i."kind" = 'pr' AND (r."stage" IN ('verify', 'ship')
          OR (r."data"->'source'->'adopted' IS NOT NULL AND r."pr" = i."number"))))`)
  return result.rows.map((row) => idRow.parse(row).id)
}

export const openRecords = async (conn: Conn): Promise<number[]> => {
  const result = await conn.db.drizzle.execute(sql`
    SELECT "id" FROM "records" WHERE "stage" <> 'done' AND ("waiting_on" <> 'nobody' OR "parked" IS NOT NULL
      OR (SELECT e."data"->>'reason' FROM "events" e WHERE e."record_id" = "records"."id"
        AND e."type" IN ('ticket.closed', 'ticket.restored') ORDER BY e."id" DESC LIMIT 1)
        IN ('archived', 'closed-on-forge'))
    ORDER BY "id"`)
  return result.rows.map((row) => idRow.parse(row).id)
}
