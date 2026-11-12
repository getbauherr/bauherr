import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/** Instance-wide key/value state written by jobs (price catalog refresh, gateway health), no API access; plus the slugs of the two jobs that write it. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "instance_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'watch-gateway';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'watch-gateway';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'refresh-prices';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'refresh-prices';
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "instance_state_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_instance_state_fk" FOREIGN KEY ("instance_state_id") REFERENCES "public"."instance_state"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "instance_state_key_idx" ON "instance_state" USING btree ("key");
  CREATE INDEX "instance_state_updated_at_idx" ON "instance_state" USING btree ("updated_at");
  CREATE INDEX "instance_state_created_at_idx" ON "instance_state" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_instance_state_id_idx" ON "payload_locked_documents_rels" USING btree ("instance_state_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "instance_state_id";
  DROP TABLE "instance_state";`)
}
