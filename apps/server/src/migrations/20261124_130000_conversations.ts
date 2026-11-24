import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const TABLES = sql`
    CREATE TABLE "conversations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"title" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "conversation_messages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"conversation_id" integer NOT NULL,
  	"role" varchar NOT NULL,
  	"text" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "conversation_files" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"conversation_id" integer NOT NULL,
  	"message_id" integer,
  	"name" varchar NOT NULL,
  	"content_type" varchar NOT NULL,
  	"byte_size" numeric NOT NULL,
  	"content" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );`

const KEYS = sql`
   ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_message_id_conversation_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id")
    ON DELETE set null ON UPDATE no action;`

const INDEXES = sql`
   CREATE INDEX "conversations_workspace_idx" ON "conversations"
    USING btree ("workspace_id");
  CREATE INDEX "conversations_updated_at_idx" ON "conversations"
    USING btree ("updated_at");
  CREATE INDEX "conversations_created_at_idx" ON "conversations"
    USING btree ("created_at");
  CREATE INDEX "conversation_messages_workspace_idx" ON "conversation_messages"
    USING btree ("workspace_id");
  CREATE INDEX "conversation_messages_conversation_idx" ON "conversation_messages"
    USING btree ("conversation_id");
  CREATE INDEX "conversation_messages_updated_at_idx" ON "conversation_messages"
    USING btree ("updated_at");
  CREATE INDEX "conversation_messages_created_at_idx" ON "conversation_messages"
    USING btree ("created_at");
  CREATE INDEX "conversation_files_workspace_idx" ON "conversation_files"
    USING btree ("workspace_id");
  CREATE INDEX "conversation_files_conversation_idx" ON "conversation_files"
    USING btree ("conversation_id");
  CREATE INDEX "conversation_files_message_idx" ON "conversation_files"
    USING btree ("message_id");
  CREATE INDEX "conversation_files_updated_at_idx" ON "conversation_files"
    USING btree ("updated_at");
  CREATE INDEX "conversation_files_created_at_idx" ON "conversation_files"
    USING btree ("created_at");`

const LOCKS = sql`
   ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "conversations_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "conversation_messages_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "conversation_files_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversations_fk"
    FOREIGN KEY ("conversations_id") REFERENCES "public"."conversations"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversation_messages_fk"
    FOREIGN KEY ("conversation_messages_id") REFERENCES "public"."conversation_messages"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversation_files_fk"
    FOREIGN KEY ("conversation_files_id") REFERENCES "public"."conversation_files"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_conversations_id_idx" ON "payload_locked_documents_rels"
    USING btree ("conversations_id");
  CREATE INDEX "payload_locked_documents_rels_conversation_messages_id_idx" ON "payload_locked_documents_rels"
    USING btree ("conversation_messages_id");
  CREATE INDEX "payload_locked_documents_rels_conversation_files_id_idx" ON "payload_locked_documents_rels"
    USING btree ("conversation_files_id");`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statements of [TABLES, KEYS, INDEXES, LOCKS]) await db.execute(statements)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "conversations_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "conversation_messages_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "conversation_files_id";
  DROP TABLE IF EXISTS "conversation_files" CASCADE;
  DROP TABLE IF EXISTS "conversation_messages" CASCADE;
  DROP TABLE IF EXISTS "conversations" CASCADE;`)
}
