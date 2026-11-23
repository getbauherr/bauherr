import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "attachments" ADD COLUMN "screen" varchar;
  ALTER TABLE "attachments" ADD COLUMN "width" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "attachments" DROP COLUMN IF EXISTS "screen";
  ALTER TABLE "attachments" DROP COLUMN IF EXISTS "width";`)
}
