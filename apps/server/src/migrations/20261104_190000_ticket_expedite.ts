import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "expedite" boolean DEFAULT false;
   ALTER TABLE "workspaces" ADD COLUMN "expedite_lane" boolean DEFAULT true;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "expedite";
   ALTER TABLE "workspaces" DROP COLUMN "expedite_lane";`)
}
