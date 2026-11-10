import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_runs_reason_kind" AS ENUM('decision', 'access', 'stuck');
   ALTER TABLE "runs" ADD COLUMN "escalation" jsonb;
   ALTER TABLE "runs" ADD COLUMN "reason_kind" "enum_runs_reason_kind";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" DROP COLUMN "escalation";
   ALTER TABLE "runs" DROP COLUMN "reason_kind";
   DROP TYPE "public"."enum_runs_reason_kind";`)
}
