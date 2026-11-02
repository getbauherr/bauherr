import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "human_touches" ALTER COLUMN "ticket_id" DROP NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DELETE FROM "human_touches" WHERE "ticket_id" IS NULL;
  ALTER TABLE "human_touches" ALTER COLUMN "ticket_id" SET NOT NULL;`)
}
