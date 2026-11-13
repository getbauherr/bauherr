import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** `tickets.expedite_yielded_to`: the Ticket a parked fast-lane holder gave its place to. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" ADD COLUMN "expedite_yielded_to" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "tickets" DROP COLUMN "expedite_yielded_to";`)
}
