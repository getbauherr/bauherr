import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // needs_you stays null for existing Tickets; the next minute's gate sweep fills it.
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "needs_you" varchar;
   CREATE INDEX "tickets_needs_you_idx" ON "tickets" USING btree ("needs_you");
   CREATE INDEX "workspace_state_idx" ON "tickets" USING btree ("workspace_id", "state");
   CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");
   CREATE INDEX "mode_status_heartbeatAt_idx" ON "runs" USING btree ("mode", "status", "heartbeat_at");
   CREATE INDEX "kind_at_idx" ON "human_touches" USING btree ("kind", "at");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "kind_at_idx";
   DROP INDEX "mode_status_heartbeatAt_idx";
   DROP INDEX "runs_status_idx";
   DROP INDEX "workspace_state_idx";
   DROP INDEX "tickets_needs_you_idx";
   ALTER TABLE "tickets" DROP COLUMN "needs_you";`)
}
