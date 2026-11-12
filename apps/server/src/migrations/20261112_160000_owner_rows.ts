import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Rows of a decision sheet that name the Product owner on a checkpoint that asks the Bauherr: the count the Inbox reads without a forge call. Filled by the next sheet write or gate sweep. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" ADD COLUMN "open_owner_rows" numeric DEFAULT 0;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" DROP COLUMN "open_owner_rows";`)
}
