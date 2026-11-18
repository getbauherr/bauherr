import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { workflowFor } from './factory'
import { isExpediting } from './expedite'
import { id } from './release'
import { sessionTimeoutS } from './sessions'
import { roleOfRun } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

export const PREEMPT_GRACE_MS = 2 * 60_000

export type Preempt = { ticket: number; run: number; reason: string }

export const pickVictim = async (tx: any, workspace: number, roleId: string, cap: number | null | undefined): Promise<number | null> => {
  const running = (await tx.execute(sql`SELECT count(*)::int AS n FROM "runs" WHERE "workspace_id" = ${workspace} AND "role" = ${roleId} AND "mode" = 'session' AND "status" = 'running'`)).rows[0] as { n: number }
  const free = (await tx.execute(sql`SELECT 1 FROM "agent_sessions" s WHERE s."workspace_id" = ${workspace} AND s."role" = ${roleId} AND s."disconnected_at" IS NULL AND s."last_seen_at" > now() - make_interval(secs => ${sessionTimeoutS()}) AND NOT EXISTS (SELECT 1 FROM "runs" r WHERE r."session_id" = s."id" AND r."status" = 'running') LIMIT 1`)).rows.length > 0
  if (free && !(cap && running.n >= cap)) return null
  for (const mode of ['session', 'autonomous']) {
    const row = (await tx.execute(sql`SELECT r."id" FROM "runs" r JOIN "tickets" t ON t."id" = r."ticket_id" WHERE r."workspace_id" = ${workspace} AND r."role" = ${roleId} AND r."mode" = ${mode} AND r."status" = 'running' AND r."preempt_at" IS NULL AND t."expedite" IS NOT TRUE ORDER BY r."started_at" DESC, r."id" DESC LIMIT 1`)).rows[0] as { id: number } | undefined
    if (row) return row.id
  }
  return null
}

export const markPreempt = async (payload: Payload, hot: Doc, ticket: Doc): Promise<number | null> => {
  const role = roleOfRun(workflowFor(hot.workspace), hot)
  if (!role) return null
  const ws = Number(id(hot.workspace))
  return payload.db.drizzle.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ws}::int, hashtext('preempt'))`)
    const on = (await tx.execute(sql`SELECT "preempt_for_hotfix" AS on FROM "workspaces" WHERE "id" = ${ws}`)).rows[0] as { on: boolean | null } | undefined
    if (on?.on === false) return null
    if ((await tx.execute(sql`SELECT "status" FROM "runs" WHERE "id" = ${hot.id}`)).rows[0]?.status !== 'awaiting_session') return null
    if ((await tx.execute(sql`SELECT 1 FROM "runs" WHERE "preempted_by" = ${hot.id} LIMIT 1`)).rows.length) return null
    const victim = await pickVictim(tx, ws, role.id, role.agents)
    if (victim == null) return null
    const done = await tx.execute(sql`UPDATE "runs" SET "preempted_by" = ${hot.id}, "preempted_for" = ${ticket.number}, "preempt_at" = now(), "updated_at" = now() WHERE "id" = ${victim} AND "status" = 'running' AND "preempt_at" IS NULL RETURNING "id"`)
    return done.rows.length ? victim : null
  })
}

export const preemptSweep = async (payload: Payload): Promise<number> => {
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ expedite: { equals: true } }, { state: { equals: 'open' } }] }, pagination: false, ...o })).docs as Doc[]
  let marked = 0
  for (const t of tickets) {
    try {
      const hot = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { mode: { equals: 'session' } }, { status: { equals: 'awaiting_session' } }] }, sort: '-id', limit: 1, ...o })).docs[0] as Doc | undefined
      if (hot && (await isExpediting(payload, t)) && (await markPreempt(payload, hot, t)) != null) marked++
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'preemptSweep failed')
    }
  }
  return marked
}

export const preemptFor = async (payload: Payload, sessionId: number | string): Promise<Preempt | null> => {
  const row = (await payload.db.drizzle.execute(sql`SELECT e."id" AS run, e."ticket_id" AS ticket, t."number" AS number FROM "runs" v JOIN "runs" e ON e."id" = v."preempted_by" JOIN "tickets" t ON t."id" = e."ticket_id" WHERE v."session_id" = ${sessionId} AND v."status" = 'running' AND v."preempt_at" IS NOT NULL AND e."status" = 'awaiting_session' LIMIT 1`)).rows[0] as { run: number; ticket: number; number: number } | undefined
  return row ? { ticket: Number(row.ticket), run: Number(row.run), reason: `hotfix #${row.number}` } : null
}

export const pausingFor = async (payload: Payload, hot: number | string): Promise<number | null> => {
  const row = (await payload.db.drizzle.execute(sql`SELECT t."number" AS number FROM "runs" v JOIN "tickets" t ON t."id" = v."ticket_id" WHERE v."preempted_by" = ${hot} AND v."status" = 'running' AND v."preempt_at" IS NOT NULL LIMIT 1`)).rows[0] as { number: number } | undefined
  return row ? Number(row.number) : null
}

export const preemptedRun = async (payload: Payload, runId: number | string): Promise<boolean> =>
  (await payload.db.drizzle.execute(sql`SELECT 1 FROM "runs" v JOIN "runs" e ON e."id" = v."preempted_by" WHERE v."id" = ${runId} AND v."status" = 'running' AND v."preempt_at" IS NOT NULL AND e."status" = 'awaiting_session' LIMIT 1`)).rows.length > 0
