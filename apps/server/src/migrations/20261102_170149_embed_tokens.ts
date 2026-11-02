import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "embed_tokens" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"name" varchar NOT NULL,
  	"product_id" integer NOT NULL,
  	"token_hash" varchar NOT NULL,
  	"allowed_origins" jsonb,
  	"max_sessions_per_hour" numeric DEFAULT 20,
  	"revoked_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "intake_sessions" ADD COLUMN "embed_token_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "embed_tokens_id" integer;
  ALTER TABLE "embed_tokens" ADD CONSTRAINT "embed_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "embed_tokens" ADD CONSTRAINT "embed_tokens_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_embed_token_id_embed_tokens_id_fk" FOREIGN KEY ("embed_token_id") REFERENCES "public"."embed_tokens"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_embed_tokens_fk" FOREIGN KEY ("embed_tokens_id") REFERENCES "public"."embed_tokens"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "embed_tokens_workspace_idx" ON "embed_tokens" USING btree ("workspace_id");
  CREATE INDEX "embed_tokens_product_idx" ON "embed_tokens" USING btree ("product_id");
  CREATE UNIQUE INDEX "embed_tokens_token_hash_idx" ON "embed_tokens" USING btree ("token_hash");
  CREATE INDEX "embed_tokens_updated_at_idx" ON "embed_tokens" USING btree ("updated_at");
  CREATE INDEX "embed_tokens_created_at_idx" ON "embed_tokens" USING btree ("created_at");
  CREATE INDEX "intake_sessions_embed_token_idx" ON "intake_sessions" USING btree ("embed_token_id");
  CREATE INDEX "payload_locked_documents_rels_embed_tokens_id_idx" ON "payload_locked_documents_rels" USING btree ("embed_tokens_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "intake_sessions" DROP COLUMN "embed_token_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "embed_tokens_id";
  DROP TABLE "embed_tokens" CASCADE;`)
}
