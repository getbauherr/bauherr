import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "statements" ADD COLUMN "scope" varchar DEFAULT 'ticket' NOT NULL;
  UPDATE "statements" SET "scope" = 'product' WHERE "kind" = 'answer';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "statements" DROP COLUMN IF EXISTS "scope";`)
}
