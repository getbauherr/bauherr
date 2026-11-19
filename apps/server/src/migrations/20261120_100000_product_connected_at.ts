import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  UPDATE "products" SET "connected_at" = now(), "updated_at" = now()
  WHERE "connected_at" IS NULL AND EXISTS (SELECT 1 FROM "ticket_sources" s WHERE s."product_id" = "products"."id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
