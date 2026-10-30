import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "bauherren" ADD COLUMN "oidc_subject" varchar;
  ALTER TABLE "bauherren" ADD COLUMN "oidc_synced" timestamp(3) with time zone;
  ALTER TABLE "bauherren" ADD COLUMN "session_version" numeric DEFAULT 0;
  CREATE UNIQUE INDEX "bauherren_oidc_subject_idx" ON "bauherren" ("oidc_subject") WHERE "oidc_subject" IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "bauherren_oidc_subject_idx";
  ALTER TABLE "bauherren" DROP COLUMN "session_version";
  ALTER TABLE "bauherren" DROP COLUMN "oidc_subject";
  ALTER TABLE "bauherren" DROP COLUMN "oidc_synced";`)
}
