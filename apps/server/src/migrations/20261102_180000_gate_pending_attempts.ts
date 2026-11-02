import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "gate_pending_attempts" numeric DEFAULT 0;
  INSERT INTO "human_touches" ("workspace_id", "kind", "ticket_id", "actor", "at")
   SELECT t."workspace_id", 'approve:inherited', t."id", '#' || p."number", t."created_at"
   FROM "tickets" t
   JOIN "tickets" p ON p."id" = t."inherited_approval_from_id"
   WHERE NOT EXISTS (SELECT 1 FROM "human_touches" h WHERE h."ticket_id" = t."id" AND h."kind" IN ('approve:plan', 'approve:inherited'));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "gate_pending_attempts";`)
}
