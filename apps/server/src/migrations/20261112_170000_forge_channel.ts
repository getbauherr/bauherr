import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * `products.gate_owners` (free-text logins) is replaced by the accounts' linked forge logins. A login that matches an account (case ignored) needs no change: the account already holds it.
 * A login without an account moves to `unlinked_gate_owners`, which Settings > Health lists until someone links it; it counts as nothing meanwhile.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN "unlinked_gate_owners" varchar;`)
  const linked = new Set(
    ((await db.execute(sql`SELECT github_login FROM "bauherren" WHERE github_login IS NOT NULL`)).rows as { github_login: string }[]).flatMap((r) => r.github_login.split(',').map((l) => l.trim().toLowerCase())),
  )
  const products = (await db.execute(sql`SELECT id, gate_owners FROM "products" WHERE gate_owners IS NOT NULL AND gate_owners <> ''`)).rows as { id: number; gate_owners: string }[]
  for (const p of products) {
    const unlinked = p.gate_owners.split(',').map((l) => l.trim().replace(/^@/, '')).filter((l) => l && !linked.has(l.toLowerCase()))
    if (unlinked.length) await db.execute(sql`UPDATE "products" SET unlinked_gate_owners = ${unlinked.join(',')} WHERE id = ${p.id}`)
  }
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN "gate_owners";`)
}

/** The matched logins stay on their accounts and are not written back; the unlinked ones return as the list. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN "gate_owners" varchar;`)
  await db.execute(sql`UPDATE "products" SET gate_owners = unlinked_gate_owners WHERE unlinked_gate_owners IS NOT NULL;`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN "unlinked_gate_owners";`)
}
