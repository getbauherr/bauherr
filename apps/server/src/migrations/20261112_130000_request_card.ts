import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_intake_sessions_kind" AS ENUM('bug', 'feature', 'change', 'question');
  CREATE TYPE "public"."enum_intake_sessions_urgency" AS ENUM('normal', 'urgent');
  ALTER TABLE "intake_sessions" ADD COLUMN "title" varchar;
  ALTER TABLE "intake_sessions" ADD COLUMN "kind" "enum_intake_sessions_kind";
  ALTER TABLE "intake_sessions" ADD COLUMN "urgency" "enum_intake_sessions_urgency" DEFAULT 'normal' NOT NULL;
  ALTER TABLE "intake_sessions" ADD COLUMN "urgent_reason" varchar;
  ALTER TABLE "intake_sessions" ADD COLUMN "edited" jsonb;
  ALTER TABLE "intake_sessions" ADD COLUMN "follow_up_of_id" integer;
  ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_follow_up_of_id_intake_sessions_id_fk" FOREIGN KEY ("follow_up_of_id") REFERENCES "public"."intake_sessions"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "intake_sessions_follow_up_of_idx" ON "intake_sessions" USING btree ("follow_up_of_id");
  UPDATE "intake_sessions" SET "kind" = ("draft"->>'type')::"enum_intake_sessions_kind" WHERE "draft"->>'type' IN ('bug', 'feature', 'question');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "intake_sessions_follow_up_of_idx";
  ALTER TABLE "intake_sessions" DROP CONSTRAINT "intake_sessions_follow_up_of_id_intake_sessions_id_fk";
  ALTER TABLE "intake_sessions" DROP COLUMN "follow_up_of_id";
  ALTER TABLE "intake_sessions" DROP COLUMN "edited";
  ALTER TABLE "intake_sessions" DROP COLUMN "urgent_reason";
  ALTER TABLE "intake_sessions" DROP COLUMN "urgency";
  ALTER TABLE "intake_sessions" DROP COLUMN "kind";
  ALTER TABLE "intake_sessions" DROP COLUMN "title";
  DROP TYPE "public"."enum_intake_sessions_urgency";
  DROP TYPE "public"."enum_intake_sessions_kind";`)
}
