import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_stage" ADD VALUE IF NOT EXISTS 'triage';
  ALTER TABLE "tickets" ADD COLUMN "triaged_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" DROP COLUMN "triaged_at";`)
  // The enum value 'triage' of enum_runs_stage stays: Postgres cannot drop an enum value.
}
