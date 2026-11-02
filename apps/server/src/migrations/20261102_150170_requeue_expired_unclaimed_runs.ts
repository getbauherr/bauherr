import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/** Unclaimed session Runs no longer expire; requeue the ones that ended `needs_human` that way (latest per Ticket + stage, none active). */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   WITH latest AS (
    SELECT max(r."id") AS id FROM "runs" r
    WHERE r."mode" = 'session' AND r."status" = 'needs_human' AND r."error" = 'session heartbeat timeout' AND r."lease_hash" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "runs" a WHERE a."ticket_id" = r."ticket_id" AND a."stage" = r."stage" AND a."status" IN ('queued', 'awaiting_session', 'running'))
    GROUP BY r."ticket_id", r."stage"
   ), ended AS (
    UPDATE "runs" SET "status" = 'abandoned', "updated_at" = now() WHERE "id" IN (SELECT id FROM latest)
    RETURNING "id", "ticket_id", "stage", "mode", "workspace_id"
   )
   INSERT INTO "runs" ("ticket_id", "stage", "mode", "status", "workspace_id", "previous_run_id")
   SELECT "ticket_id", "stage", "mode", 'awaiting_session', "workspace_id", "id" FROM ended;`)
}

export async function down(_: MigrateDownArgs): Promise<void> {}
