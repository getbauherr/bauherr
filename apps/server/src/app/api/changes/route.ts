import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { isBauherr, isProductOwner } from '../../../lib/people'
import { currentWorkspace, getPerson, payloadClient } from '../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const version = z.object({ v: z.coerce.number().nullable() })

export const GET = async (): Promise<Response> => {
  const person = await getPerson()
  if (!person || isProductOwner(person) || !isBauherr(person)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { workspace } = await currentWorkspace()
  if (!workspace) return Response.json({ v: 0 })
  const id = workspace.id
  const { rows } = await (await payloadClient()).db.drizzle.execute(sql`
    SELECT (extract(epoch FROM greatest(
      (SELECT max("updated_at") FROM "records" WHERE "workspace_id" = ${id}),
      (SELECT max("updated_at") FROM "events" WHERE "workspace_id" = ${id}),
      (SELECT max("updated_at") FROM "stage_runs" WHERE "workspace_id" = ${id}),
      (SELECT max("updated_at") FROM "mirror_items" WHERE "workspace_id" = ${id}),
      (SELECT max("updated_at") FROM "agent_sessions" WHERE "workspace_id" = ${id}))) * 1000)::bigint AS v`)
  return Response.json({ v: version.parse(rows[0]).v ?? 0 })
}
