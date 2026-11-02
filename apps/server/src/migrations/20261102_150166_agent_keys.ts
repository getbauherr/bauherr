import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "agent_keys" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"owner_id" integer NOT NULL,
  	"label" varchar NOT NULL,
  	"key_hash" varchar NOT NULL,
  	"prefix" varchar NOT NULL,
  	"last_used_at" timestamp(3) with time zone,
  	"revoked_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_owner_id_bauherren_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "agent_keys_owner_idx" ON "agent_keys" USING btree ("owner_id");
  CREATE UNIQUE INDEX "agent_keys_key_hash_idx" ON "agent_keys" USING btree ("key_hash");
  CREATE INDEX "agent_keys_updated_at_idx" ON "agent_keys" USING btree ("updated_at");
  CREATE INDEX "agent_keys_created_at_idx" ON "agent_keys" USING btree ("created_at");
  ALTER TABLE "runs" ADD COLUMN "agent_key_id" integer;
  ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "runs_agent_key_idx" ON "runs" USING btree ("agent_key_id");
  ALTER TABLE "tool_calls" ADD COLUMN "agent_key_id" integer;
  ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "tool_calls_agent_key_idx" ON "tool_calls" USING btree ("agent_key_id");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "agent_keys_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_agent_keys_fk" FOREIGN KEY ("agent_keys_id") REFERENCES "public"."agent_keys"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_agent_keys_id_idx" ON "payload_locked_documents_rels" USING btree ("agent_keys_id");
  -- D2: personal keys were handed to agents under the old docs; disable them. Owners mint an agent key (Settings, API key).
  UPDATE "bauherren" SET "enable_a_p_i_key" = false, "api_key" = NULL, "api_key_index" = NULL WHERE "enable_a_p_i_key" = true OR "api_key_index" IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "agent_keys_id";
  ALTER TABLE "tool_calls" DROP COLUMN "agent_key_id";
  ALTER TABLE "runs" DROP COLUMN "agent_key_id";
  DROP TABLE "agent_keys" CASCADE;`)
}
