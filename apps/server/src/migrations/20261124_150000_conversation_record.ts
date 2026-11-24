import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "conversations" ADD COLUMN "record_id" integer;
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "conversations_record_idx" ON "conversations" USING btree ("record_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "record_id";`)
}
