import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE UNIQUE INDEX "human_touches_ship_release_per_tag" ON "human_touches" ("repo", "status") WHERE "kind" = 'ship:release';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "human_touches_ship_release_per_tag";`)
}
