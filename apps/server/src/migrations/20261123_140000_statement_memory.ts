import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "statements" ADD COLUMN "applies" varchar DEFAULT 'fit' NOT NULL;
  ALTER TABLE "statements" ADD COLUMN "area" varchar;
  ALTER TABLE "statements" ADD COLUMN "stages" jsonb DEFAULT '["brief","build","review","verify"]'::jsonb NOT NULL;
  ALTER TABLE "statements" ADD COLUMN "off" boolean DEFAULT false NOT NULL;
  ALTER TABLE "statements" ADD COLUMN "original_text" varchar;
  ALTER TABLE "statements" ALTER COLUMN "record_id" DROP NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "statements" WHERE "record_id" IS NULL;
  ALTER TABLE "statements" ALTER COLUMN "record_id" SET NOT NULL;
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "original_text";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "off";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "stages";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "area";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "applies";`)
}
