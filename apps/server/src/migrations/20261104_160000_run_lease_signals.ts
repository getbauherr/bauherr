import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" ADD COLUMN "last_lease_call" varchar;
  ALTER TABLE "runs" ADD COLUMN "last_seen_sha" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" DROP COLUMN "last_lease_call";
  ALTER TABLE "runs" DROP COLUMN "last_seen_sha";`)
}
