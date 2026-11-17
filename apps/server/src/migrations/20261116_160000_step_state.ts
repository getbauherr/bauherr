import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_steps_state" AS ENUM('working', 'waiting_ci');
  ALTER TABLE "steps" ADD COLUMN "state" "enum_steps_state";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "steps" DROP COLUMN "state";
  DROP TYPE "public"."enum_steps_state";`)
}
