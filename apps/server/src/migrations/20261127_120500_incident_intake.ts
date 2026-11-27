import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "incident_intake" boolean DEFAULT false;
  ALTER TABLE "products" ADD COLUMN "incident_secret" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" DROP COLUMN "incident_secret";
  ALTER TABLE "products" DROP COLUMN "incident_intake";`)
}
