import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "caused_by_id" integer;
   DO $$ BEGIN
    ALTER TABLE "tickets" ADD CONSTRAINT "tickets_caused_by_id_tickets_id_fk" FOREIGN KEY ("caused_by_id") REFERENCES
        "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   CREATE INDEX IF NOT EXISTS "tickets_caused_by_idx" ON "tickets" USING btree ("caused_by_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "tickets_caused_by_idx";
   ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_caused_by_id_tickets_id_fk";
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "caused_by_id";`)
}
