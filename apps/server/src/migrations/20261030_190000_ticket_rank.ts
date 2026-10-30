import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "rank" varchar;
  CREATE INDEX "tickets_rank_idx" ON "tickets" USING btree ("rank");
  UPDATE "tickets" t SET "rank" = o.r FROM (SELECT "id", lpad((row_number() OVER (PARTITION BY "workspace_id" ORDER BY "number", "id"))::text, 6, '0') AS r FROM "tickets") o WHERE t."id" = o."id";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "tickets_rank_idx";
  ALTER TABLE "tickets" DROP COLUMN "rank";`)
}
