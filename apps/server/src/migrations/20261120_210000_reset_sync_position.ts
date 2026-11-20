import { MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  UPDATE "ticket_sources"
  SET "cursor" = NULL, "imported_at" = NULL, "lookback_at" = NULL, "reconciled_at" = NULL;`)
}

export async function down(): Promise<void> {
  await Promise.resolve()
}
