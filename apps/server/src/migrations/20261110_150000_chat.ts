import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "chat_threads" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"owner_id" integer NOT NULL,
  	"title" varchar,
  	"context" jsonb,
  	"pending" jsonb,
  	"archived_at" timestamp(3) with time zone,
  	"last_message_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "chat_messages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"thread_id" integer NOT NULL,
  	"message_id" varchar NOT NULL,
  	"parent_id" varchar,
  	"message" jsonb,
  	"role" varchar,
  	"answer" jsonb,
  	"feedback" varchar,
  	"feedback_reasons" jsonb,
  	"feedback_note" varchar,
  	"feedback_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "chat_threads_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "chat_messages_id" integer;
  ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_owner_id_bauherren_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."bauherren"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "chat_threads_workspace_idx" ON "chat_threads" USING btree ("workspace_id");
  CREATE INDEX "chat_threads_owner_idx" ON "chat_threads" USING btree ("owner_id");
  CREATE INDEX "chat_threads_last_message_at_idx" ON "chat_threads" USING btree ("last_message_at");
  CREATE INDEX "chat_threads_updated_at_idx" ON "chat_threads" USING btree ("updated_at");
  CREATE INDEX "chat_threads_created_at_idx" ON "chat_threads" USING btree ("created_at");
  CREATE INDEX "chat_messages_workspace_idx" ON "chat_messages" USING btree ("workspace_id");
  CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id");
  CREATE INDEX "chat_messages_updated_at_idx" ON "chat_messages" USING btree ("updated_at");
  CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages" USING btree ("created_at");
  CREATE UNIQUE INDEX "thread_messageId_idx" ON "chat_messages" USING btree ("thread_id","message_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_chat_threads_fk" FOREIGN KEY ("chat_threads_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_chat_messages_fk" FOREIGN KEY ("chat_messages_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_chat_threads_id_idx" ON "payload_locked_documents_rels" USING btree ("chat_threads_id");
  CREATE INDEX "payload_locked_documents_rels_chat_messages_id_idx" ON "payload_locked_documents_rels" USING btree ("chat_messages_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "chat_threads_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "chat_messages_id";
  DROP TABLE "chat_messages" CASCADE;
  DROP TABLE "chat_threads" CASCADE;`)
}
