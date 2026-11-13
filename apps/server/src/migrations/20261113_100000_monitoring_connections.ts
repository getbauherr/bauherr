import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** `monitoring` Connections (docs/observability.md): one per `service` on the instance, details in `config`, credential in `secret`. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_connections_kind" ADD VALUE IF NOT EXISTS 'monitoring';`)
  await db.execute(sql`CREATE TYPE "public"."enum_connections_service" AS ENUM('otlp', 'prometheus', 'grafana');`)
  await db.execute(sql`ALTER TABLE "connections" ADD COLUMN "service" "enum_connections_service";`)
}

/** The enum value 'monitoring' of enum_connections_kind stays: Postgres cannot drop an enum value. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DELETE FROM "connections" WHERE "service" IS NOT NULL;`)
  await db.execute(sql`ALTER TABLE "connections" DROP COLUMN "service";`)
  await db.execute(sql`DROP TYPE "public"."enum_connections_service";`)
}
