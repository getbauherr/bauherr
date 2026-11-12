import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** Addressed checkpoints: who a Ticket's need asks (`tickets.needs_by`), who decided and for whom (`human_touches.as`, `addressee`), and the Product switch "Product owner tests on staging". Every need before this change asked the Bauherr, so it is backfilled that way. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_tickets_needs_by" AS ENUM('bauherr', 'product-owner');
  CREATE TYPE "public"."enum_human_touches_as" AS ENUM('bauherr', 'product-owner');
  CREATE TYPE "public"."enum_human_touches_addressee" AS ENUM('bauherr', 'product-owner');
  ALTER TABLE "tickets" ADD COLUMN "needs_by" "enum_tickets_needs_by";
  ALTER TABLE "human_touches" ADD COLUMN "as" "enum_human_touches_as";
  ALTER TABLE "human_touches" ADD COLUMN "addressee" "enum_human_touches_addressee";
  ALTER TABLE "products" ADD COLUMN "product_owner_tests_staging" boolean DEFAULT false;
  CREATE INDEX "tickets_needs_by_idx" ON "tickets" USING btree ("needs_by");
  UPDATE "tickets" SET "needs_by" = 'bauherr' WHERE "needs_you" IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "tickets_needs_by_idx";
  ALTER TABLE "products" DROP COLUMN "product_owner_tests_staging";
  ALTER TABLE "human_touches" DROP COLUMN "addressee";
  ALTER TABLE "human_touches" DROP COLUMN "as";
  ALTER TABLE "tickets" DROP COLUMN "needs_by";
  DROP TYPE "public"."enum_human_touches_addressee";
  DROP TYPE "public"."enum_human_touches_as";
  DROP TYPE "public"."enum_tickets_needs_by";`)
}
