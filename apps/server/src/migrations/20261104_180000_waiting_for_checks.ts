import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_tickets_waiting_for" ADD VALUE IF NOT EXISTS 'checks';`)
}

export async function down(_: MigrateDownArgs): Promise<void> {}
