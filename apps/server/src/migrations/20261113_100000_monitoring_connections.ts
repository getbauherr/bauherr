import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_connections_kind" ADD VALUE IF NOT EXISTS 'monitoring';`)
  await db.execute(sql`CREATE TYPE "public"."enum_connections_service" AS ENUM('otlp', 'prometheus', 'grafana');`)
  await db.execute(sql`ALTER TABLE "connections" ADD COLUMN "service" "enum_connections_service";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  const rows = Number((await db.execute(sql`SELECT count(*) AS n FROM "connections" WHERE "service" IS NOT NULL;`)).rows[0]?.n ?? 0)
  if (rows) throw new Error(`Cannot roll back: ${rows} monitoring Connection(s) exist. Remove them under Settings > Connections > Monitoring first.`)
  await db.execute(sql`ALTER TABLE "connections" DROP COLUMN "service";`)
  await db.execute(sql`DROP TYPE "public"."enum_connections_service";`)
}
