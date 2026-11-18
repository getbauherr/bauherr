import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { canSeeProduct } from '../../../lib/people'
import { currentWorkspace, getBauherr, payloadClient } from './session'

export type Milestone = { kind: 'step' | 'event'; at: string; text: string; run?: number }

export const liveTicket = async (rawId: string): Promise<{ payload: Payload; id: number } | Response> => {
  const user = await getBauherr()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const t = /^\d+$/.test(rawId) && workspace ? ((await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: rawId } }, { workspace: { equals: workspace.id } }] }, limit: 1, select: { product: true, workspace: true }, depth: 0, overrideAccess: true })).docs[0] as { id: number; product: number; workspace: number } | undefined) : undefined
  if (!t || !canSeeProduct(user, { id: t.product, workspace: t.workspace })) return Response.json({ error: 'not found' }, { status: 404 })
  return { payload, id: t.id }
}

export const ticketVersion = async (payload: Payload, id: number): Promise<number> => {
  const { rows } = await payload.db.drizzle.execute(
    sql`SELECT (extract(epoch FROM greatest((SELECT "updated_at" FROM "tickets" WHERE "id" = ${id}), (SELECT max("updated_at") FROM "runs" WHERE "ticket_id" = ${id}), (SELECT max(s."updated_at") FROM "steps" s JOIN "runs" r ON r."id" = s."run_id" WHERE r."ticket_id" = ${id}), (SELECT max("updated_at") FROM "agent_sessions" WHERE "id" IN (SELECT "session_id" FROM "runs" WHERE "ticket_id" = ${id})), (SELECT max("updated_at") FROM "ticket_events" WHERE "ticket_id" = ${id}), (SELECT max("updated_at") FROM "human_touches" WHERE "ticket_id" = ${id}))) * 1000)::bigint AS v`,
  )
  return Number((rows[0] as { v: string | null }).v ?? 0)
}

export const cursorOf = (m: { at: number; kind: string; id: number }): string => `${m.at}:${m.kind}:${m.id}`

export const milestonesAfter = async (payload: Payload, id: number, cursor: string): Promise<{ cursor: string; milestone: Milestone }[]> => {
  const [ms, kind, n] = cursor.split(':')
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT * FROM (
      SELECT 'step' AS kind, s."id", s."created_at" AS at, coalesce(s."summary", 'Step ' || coalesce(s."seq"::text, '')) AS text, s."run_id" AS run FROM "steps" s JOIN "runs" r ON r."id" = s."run_id" WHERE r."ticket_id" = ${id}
      UNION ALL
      SELECT 'event', e."id", e."at", concat_ws(' · ', e."stage", e."phase"::text, e."outcome"), e."run_id" FROM "ticket_events" e WHERE e."ticket_id" = ${id}
    ) m WHERE (m.at, m.kind, m.id) > (to_timestamp((${Number(ms)}::double precision) / 1000), ${kind ?? ''}::text, ${Number(n)}::int) ORDER BY m.at, m.kind, m.id LIMIT 100`)
  return (rows as { kind: 'step' | 'event'; id: number; at: Date | string; text: string; run: number | null }[]).map((r) => {
    const at = new Date(r.at)
    return { cursor: cursorOf({ at: +at, kind: r.kind, id: r.id }), milestone: { kind: r.kind, at: at.toISOString(), text: r.text, ...(r.run && { run: r.run }) } }
  })
}
