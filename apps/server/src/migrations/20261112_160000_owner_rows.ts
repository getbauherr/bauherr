import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" ADD COLUMN "open_owner_rows" numeric DEFAULT 0;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" DROP COLUMN "open_owner_rows";`)
}
