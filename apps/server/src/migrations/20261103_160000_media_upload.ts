import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" DROP CONSTRAINT "media_session_id_intake_sessions_id_fk";
  ALTER TABLE "media" ALTER COLUMN "session_id" DROP NOT NULL;
  ALTER TABLE "media" ALTER COLUMN "mime" DROP NOT NULL;
  ALTER TABLE "media" ALTER COLUMN "data" DROP NOT NULL;
  ALTER TABLE "media" ADD COLUMN "product_id" integer;
  ALTER TABLE "media" ADD COLUMN "ticket_number" numeric;
  ALTER TABLE "media" ADD COLUMN "prefix" varchar DEFAULT '';
  ALTER TABLE "media" ADD COLUMN "_objectkey" varchar;
  ALTER TABLE "media" ADD COLUMN "url" varchar;
  ALTER TABLE "media" ADD COLUMN "thumbnail_u_r_l" varchar;
  ALTER TABLE "media" ADD COLUMN "filename" varchar;
  ALTER TABLE "media" ADD COLUMN "mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "width" numeric;
  ALTER TABLE "media" ADD COLUMN "height" numeric;
  ALTER TABLE "media" ADD COLUMN "focal_x" numeric;
  ALTER TABLE "media" ADD COLUMN "focal_y" numeric;
  ALTER TABLE "media" ADD CONSTRAINT "media_session_id_intake_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."intake_sessions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "media" ADD CONSTRAINT "media_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "media_product_idx" ON "media" USING btree ("product_id");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DELETE FROM "media" WHERE "data" IS NULL OR "session_id" IS NULL OR "mime" IS NULL;
  ALTER TABLE "media" DROP CONSTRAINT "media_session_id_intake_sessions_id_fk";
  ALTER TABLE "media" DROP CONSTRAINT "media_product_id_products_id_fk";
  DROP INDEX "media_product_idx";
  DROP INDEX "media_filename_idx";
  ALTER TABLE "media" DROP COLUMN "product_id", DROP COLUMN "ticket_number", DROP COLUMN "prefix", DROP COLUMN "_objectkey", DROP COLUMN "url", DROP COLUMN "thumbnail_u_r_l", DROP COLUMN "filename", DROP COLUMN "mime_type", DROP COLUMN "filesize", DROP COLUMN "width", DROP COLUMN "height", DROP COLUMN "focal_x", DROP COLUMN "focal_y";
  ALTER TABLE "media" ALTER COLUMN "session_id" SET NOT NULL;
  ALTER TABLE "media" ALTER COLUMN "mime" SET NOT NULL;
  ALTER TABLE "media" ALTER COLUMN "data" SET NOT NULL;
  ALTER TABLE "media" ADD CONSTRAINT "media_session_id_intake_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."intake_sessions"("id") ON DELETE cascade ON UPDATE no action;`)
}
