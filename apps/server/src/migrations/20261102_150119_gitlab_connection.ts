import { MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_connections_kind" ADD VALUE IF NOT EXISTS 'gitlab';`)
}

export async function down(): Promise<void> {
}
