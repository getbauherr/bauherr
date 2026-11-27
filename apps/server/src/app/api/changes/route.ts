import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { isBauherr, isProductOwner } from '../../../lib/people'
import { CHANGE_TABLES, type ChangeTable } from '../../(app)/lib/change-tables'
import { currentWorkspace, getPerson, payloadClient } from '../../(app)/lib/session'
import { unauthorized } from '../../(app)/lib/unauthorized'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stamps = z.record(z.string(), z.coerce.number().nullable())
const requested = z.array(z.enum(CHANGE_TABLES))

const latest = (table: ChangeTable, id: number) =>
  table === 'ticket_sources'
    ? sql`(SELECT greatest(max("imported_at"), max("facts_at")) FROM "ticket_sources" WHERE "workspace_id" = ${id})`
    : sql`(SELECT max("updated_at") FROM ${sql.identifier(table)} WHERE "workspace_id" = ${id})`

export const GET = async (request?: Request): Promise<Response> => {
  const person = await getPerson()
  if (!person || isProductOwner(person) || !isBauherr(person)) {
    return unauthorized('unauthorized')
  }
  const { workspace } = await currentWorkspace()
  if (!workspace) return Response.json({ v: 0, stamps: {} })
  const raw = request ? new URL(request.url).searchParams.get('tables') : null
  const parsed = requested.safeParse(raw === null ? CHANGE_TABLES : raw.split(','))
  if (!parsed.success) return Response.json({ error: 'unknown table' }, { status: 400 })
  const tables = parsed.data
  const columns = tables.map(
    (table) => sql`(extract(epoch FROM ${latest(table, workspace.id)}) * 1000)::bigint AS ${sql.identifier(table)}`,
  )
  const { rows } = await (await payloadClient()).db.drizzle.execute(sql`SELECT ${sql.join(columns, sql`, `)}`)
  const byTable = stamps.parse(rows[0])
  const v = Math.max(0, ...Object.values(byTable).map((stamp) => stamp ?? 0))
  return Response.json({ v, stamps: byTable })
}
