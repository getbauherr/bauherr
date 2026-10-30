import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "triage_attempts" numeric DEFAULT 0;
  ALTER TABLE "tickets" ADD COLUMN "triage_attempt_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "triage_attempts";
  ALTER TABLE "tickets" DROP COLUMN "triage_attempt_at";`)
}
