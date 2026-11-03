import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "intake_sessions" ADD COLUMN "split" jsonb;
  ALTER TABLE "intake_sessions" ADD COLUMN "turn" jsonb;
  ALTER TABLE "intake_sessions" ADD COLUMN "ticket_numbers" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "intake_sessions" DROP COLUMN "split";
  ALTER TABLE "intake_sessions" DROP COLUMN "turn";
  ALTER TABLE "intake_sessions" DROP COLUMN "ticket_numbers";`)
}
