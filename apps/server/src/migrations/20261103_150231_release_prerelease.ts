import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tickets_release_checks_state" AS ENUM('waiting', 'passed', 'failed');
  ALTER TABLE "tickets" ADD COLUMN "release_tag" varchar;
  ALTER TABLE "tickets" ADD COLUMN "release_sha" varchar;
  ALTER TABLE "tickets" ADD COLUMN "release_checks_state" "enum_tickets_release_checks_state";
  ALTER TABLE "tickets" ADD COLUMN "release_run_url" varchar;
  ALTER TABLE "products" ADD COLUMN "release_prerelease" boolean DEFAULT false;
  ALTER TABLE "products" ADD COLUMN "release_checks" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "release_tag";
  ALTER TABLE "tickets" DROP COLUMN "release_sha";
  ALTER TABLE "tickets" DROP COLUMN "release_checks_state";
  ALTER TABLE "tickets" DROP COLUMN "release_run_url";
  ALTER TABLE "products" DROP COLUMN "release_prerelease";
  ALTER TABLE "products" DROP COLUMN "release_checks";
  DROP TYPE "public"."enum_tickets_release_checks_state";`)
}
