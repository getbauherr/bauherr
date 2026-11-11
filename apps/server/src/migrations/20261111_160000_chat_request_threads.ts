import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "chat_threads" ADD COLUMN "request" boolean DEFAULT false;
  ALTER TABLE "chat_threads" ADD COLUMN "intake_session_id" integer;
  ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_intake_session_id_intake_sessions_id_fk" FOREIGN KEY ("intake_session_id") REFERENCES "public"."intake_sessions"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "chat_threads_intake_session_idx" ON "chat_threads" USING btree ("intake_session_id");
  CREATE UNIQUE INDEX "chat_threads_owner_intake_session_idx" ON "chat_threads" USING btree ("owner_id", "intake_session_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "chat_threads_owner_intake_session_idx";
  ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_intake_session_id_intake_sessions_id_fk";
  DROP INDEX "chat_threads_intake_session_idx";
  ALTER TABLE "chat_threads" DROP COLUMN "intake_session_id";
  ALTER TABLE "chat_threads" DROP COLUMN "request";`)
}
