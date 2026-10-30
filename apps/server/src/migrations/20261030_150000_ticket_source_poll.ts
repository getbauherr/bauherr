import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ticket_sources" ADD COLUMN "last_polled_at" timestamp(3) with time zone;
  ALTER TABLE "ticket_sources" ADD COLUMN "last_error" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ticket_sources" DROP COLUMN "last_polled_at";
  ALTER TABLE "ticket_sources" DROP COLUMN "last_error";`)
}
