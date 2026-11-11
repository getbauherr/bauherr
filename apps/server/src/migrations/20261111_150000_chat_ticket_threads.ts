import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "chat_threads" ADD COLUMN "ticket_id" integer;
  ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "chat_threads_ticket_idx" ON "chat_threads" USING btree ("ticket_id");
  CREATE UNIQUE INDEX "chat_threads_owner_ticket_idx" ON "chat_threads" USING btree ("owner_id", "ticket_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "chat_threads_owner_ticket_idx";
  ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_ticket_id_tickets_id_fk";
  DROP INDEX "chat_threads_ticket_idx";
  ALTER TABLE "chat_threads" DROP COLUMN "ticket_id";`)
}
