import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "last_release_tag" varchar;
   ALTER TABLE "products" ADD COLUMN "last_release_sha" varchar;
   ALTER TABLE "products" ADD COLUMN "last_release_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "last_release_at";
   ALTER TABLE "products" DROP COLUMN "last_release_sha";
   ALTER TABLE "products" DROP COLUMN "last_release_tag";`)
}
