import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "inherited_approval_from_id" integer;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_inherited_approval_from_id_tickets_id_fk" FOREIGN KEY ("inherited_approval_from_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "tickets_inherited_approval_from_idx" ON "tickets" USING btree ("inherited_approval_from_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP CONSTRAINT "tickets_inherited_approval_from_id_tickets_id_fk";
  DROP INDEX "tickets_inherited_approval_from_idx";
  ALTER TABLE "tickets" DROP COLUMN "inherited_approval_from_id";`)
}
