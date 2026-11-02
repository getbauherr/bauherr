import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "intake_sessions_ip_idx";
  ALTER TABLE "intake_sessions" DROP COLUMN "ip";
  ALTER TABLE "intake_sessions" ADD COLUMN "user_id" integer;
  ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_user_id_bauherren_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauherren"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "intake_sessions_user_idx" ON "intake_sessions" USING btree ("user_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "intake_sessions" DROP CONSTRAINT "intake_sessions_user_id_bauherren_id_fk";
  DROP INDEX "intake_sessions_user_idx";
  ALTER TABLE "intake_sessions" DROP COLUMN "user_id";
  ALTER TABLE "intake_sessions" ADD COLUMN "ip" varchar;
  CREATE INDEX "intake_sessions_ip_idx" ON "intake_sessions" USING btree ("ip");`)
}
