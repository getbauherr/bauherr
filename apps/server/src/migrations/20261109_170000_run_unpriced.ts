import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_reconcile_status" ADD VALUE IF NOT EXISTS 'unpriced';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
