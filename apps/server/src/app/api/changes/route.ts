import { sql } from '@payloadcms/db-postgres'
import { currentWorkspace, getBauherr, payloadClient } from '../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `{ v }`: the newest `updated_at` (epoch ms) of the selected Workspace's Tickets and Runs; the Board refreshes only when it moves. One query, signed-in Bauherrs only. */
export const GET = async (): Promise<Response> => {
  if (!(await getBauherr())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { workspace } = await currentWorkspace()
  if (!workspace) return Response.json({ v: 0 })
  const { rows } = await (await payloadClient()).db.drizzle.execute(
    sql`SELECT (extract(epoch FROM greatest((SELECT max("updated_at") FROM "tickets" WHERE "workspace_id" = ${workspace.id}), (SELECT max("updated_at") FROM "runs" WHERE "workspace_id" = ${workspace.id}))) * 1000)::bigint AS v`,
  )
  return Response.json({ v: Number((rows[0] as { v: string | null }).v ?? 0) })
}
