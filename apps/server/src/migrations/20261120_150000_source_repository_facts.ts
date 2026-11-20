import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "ticket_sources" ADD COLUMN "default_branch" varchar;
  ALTER TABLE "ticket_sources" ADD COLUMN "branch_protected" varchar;
  ALTER TABLE "ticket_sources" ADD COLUMN "required_check_names" jsonb;
  ALTER TABLE "ticket_sources" ADD COLUMN "has_agents_file" boolean;
  ALTER TABLE "ticket_sources" ADD COLUMN "issue_form_count" numeric;
  ALTER TABLE "ticket_sources" ADD COLUMN "facts_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "default_branch";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "branch_protected";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "required_check_names";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "has_agents_file";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "issue_form_count";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "facts_at";`)
}
