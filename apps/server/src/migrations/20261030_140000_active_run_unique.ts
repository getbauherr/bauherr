import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE UNIQUE INDEX "runs_active_per_ticket_stage" ON "runs" ("ticket_id", "stage") WHERE "status" IN ('queued', 'awaiting_session', 'running');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "runs_active_per_ticket_stage";`)
}
