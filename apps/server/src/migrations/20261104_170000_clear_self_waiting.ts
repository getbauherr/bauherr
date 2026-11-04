import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`UPDATE "tickets" SET "waiting_for" = NULL WHERE "waiting_for"::text = "stage" AND "waiting_reason" IS NULL`)
}

// The cleared rows cannot be reconstructed.
export async function down(_: MigrateDownArgs): Promise<void> {}
