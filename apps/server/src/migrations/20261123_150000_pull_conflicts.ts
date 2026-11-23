import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "mirror_items" ADD COLUMN "base_ref" varchar;
  ALTER TABLE "mirror_items" ADD COLUMN "conflict_sha" varchar;
  ALTER TABLE "mirror_items" ADD COLUMN "merge_check" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "mirror_items" DROP COLUMN "base_ref";
  ALTER TABLE "mirror_items" DROP COLUMN "conflict_sha";
  ALTER TABLE "mirror_items" DROP COLUMN "merge_check";`)
}
