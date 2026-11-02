import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/** Merges tickets sharing (product, external_id) into the lowest id (every FK to tickets.id is repointed), then enforces uniqueness. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$
   DECLARE fk record;
   BEGIN
     CREATE TEMP TABLE ticket_dupes ON COMMIT DROP AS
       SELECT id AS dupe, min(id) OVER (PARTITION BY product_id, external_id) AS keep FROM "tickets";
     DELETE FROM ticket_dupes WHERE dupe = keep;
     FOR fk IN
       SELECT c.conrelid::regclass AS tbl, a.attname AS col
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND c.confrelid = 'public.tickets'::regclass
     LOOP
       EXECUTE format('UPDATE %s t SET %I = d.keep FROM ticket_dupes d WHERE t.%I = d.dupe', fk.tbl, fk.col, fk.col);
     END LOOP;
     DELETE FROM "tickets" WHERE id IN (SELECT dupe FROM ticket_dupes);
   END $$;
   CREATE UNIQUE INDEX "product_external_id_idx" ON "tickets" ("product_id", "external_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "product_external_id_idx";`)
}
