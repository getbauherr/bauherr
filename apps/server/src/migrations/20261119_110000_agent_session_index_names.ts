import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

const RENAMES = [
  ['last_seen_at_idx', 'lastSeenAt_idx'],
  ['workspace_disconnected_at_idx', 'workspace_disconnectedAt_idx'],
  ['workspace_owner_client_key_idx', 'workspace_owner_clientKey_idx'],
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const [from, to] of RENAMES) await db.execute(sql.raw(`ALTER INDEX IF EXISTS "${from}" RENAME TO "${to}"`))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const [from, to] of RENAMES) await db.execute(sql.raw(`ALTER INDEX IF EXISTS "${to}" RENAME TO "${from}"`))
}
