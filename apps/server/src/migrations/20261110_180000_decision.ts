import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "decision" jsonb;
   ALTER TABLE "tickets" ADD COLUMN "plan_tldr" jsonb;
   ALTER TABLE "tickets" ADD COLUMN "staging_tldr" jsonb;
   ALTER TABLE "tickets" ADD COLUMN "decided_at" timestamp(3) with time zone;
   ALTER TABLE "tickets" ADD COLUMN "decided_need" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "decision";
   ALTER TABLE "tickets" DROP COLUMN "plan_tldr";
   ALTER TABLE "tickets" DROP COLUMN "staging_tldr";
   ALTER TABLE "tickets" DROP COLUMN "decided_at";
   ALTER TABLE "tickets" DROP COLUMN "decided_need";`)
}
