import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const SCHEMA_SQL = `
SELECT 'column ' || c.table_name || '.' || c.column_name || ' ' || c.data_type || '(' || c.udt_name
  || ') null=' || c.is_nullable || ' default='
  || coalesce(regexp_replace(c.column_default, 'nextval\\(''[a-z_]+''::regclass\\)', 'nextval'), '-') AS line
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name <> 'payload_migrations'
UNION ALL
SELECT 'table ' || tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename <> 'payload_migrations'
UNION ALL
SELECT 'constraint ' || cl.relname || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
FROM pg_constraint co
JOIN pg_class cl ON cl.oid = co.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public' AND cl.relname <> 'payload_migrations'
UNION ALL
SELECT 'index ' || indexname || ' ' || indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename <> 'payload_migrations'
UNION ALL
SELECT 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumlabel)
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' GROUP BY t.typname
UNION ALL
SELECT 'sequence ' || sequencename FROM pg_sequences
WHERE schemaname = 'public' AND sequencename <> 'payload_migrations_id_seq'
UNION ALL
SELECT 'view ' || viewname FROM pg_views WHERE schemaname = 'public'
`

const EXCEPTIONS = [
  {
    prefix: 'constraint learn_events_archive ',
    reason: 'The archive cascades with its Workspace and Ticket so a deleted Workspace is purged.',
  },
  {
    prefix: 'table learn_events_archive',
    reason: 'A safety copy of the removed learn events kept by a migration; no collection reads it.',
  },
  {
    prefix: 'column learn_events_archive.',
    reason: 'A safety copy of the removed learn events kept by a migration; no collection reads it.',
  },
  {
    prefix: 'constraint agent_keys agent_keys_owner_id_bauherren_id_fk ',
    reason:
      'Deleting a user deletes the keys (ON DELETE CASCADE); ' +
      'Payload relationships always generate ON DELETE SET NULL and have no option for it.',
  },
  {
    prefix: 'index bauherren_oidc_subject_idx ',
    reason:
      'The migration makes it unique and partial (WHERE oidc_subject IS NOT NULL); ' +
      'a collection field can only declare a plain index.',
  },
  {
    prefix: 'index stage_runs_one_live_per_record_idx ',
    reason:
      'The migration makes it unique and partial (WHERE status IN (queued, claimed)): one live run per record; ' +
      'a collection can only declare a plain index.',
  },
  {
    prefix: 'index knowledge_chunks_fts_idx ',
    reason:
      'The full-text GIN index over heading and text exists only through its migration; ' +
      'collections cannot declare expression indexes.',
  },
  {
    prefix: 'index mirror_items_fts_idx ',
    reason:
      'The full-text GIN index over title and body exists only through its migration; ' +
      'collections cannot declare expression indexes.',
  },
  {
    prefix: 'index statements_fts_idx ',
    reason:
      'The full-text GIN index over the statement text exists only through its migration; ' +
      'collections cannot declare expression indexes.',
  },
  {
    prefix: 'enum enum_payload_jobs_',
    reason:
      'Migrated databases keep the slugs of removed job tasks in the job-slug enums; ' +
      'push builds only the current slugs.',
  },
]

const DRIFT_HELP =
  'Schema drift between src/migrations and src/collections. Fix the place that is wrong: ' +
  'a new migration when production must change, the collection when the collection is wrong. ' +
  'If the collection cannot express what the migration rightly creates, ' +
  'add an exception with its reason to EXCEPTIONS in this test.'

const STALE_HELP =
  'Remove the exception from EXCEPTIONS in tests/schema-parity.test.ts: the difference it names is gone.'

const runBuild = promisify(execFile)
let migrated: TestDb
let pushed: TestDb

const build = (mode: 'migrate' | 'push', db: TestDb) =>
  runBuild(process.execPath, ['--import', 'tsx', 'tests/helpers/schema-build.ts', mode, db.url], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: db.url },
  })

const describeSchema = async (db: TestDb): Promise<Set<string>> => {
  const client = new pg.Client({ connectionString: db.url })
  await client.connect()
  try {
    const rows = (await client.query<{ line: string }>(SCHEMA_SQL)).rows
    return new Set(rows.map((r) => r.line))
  } finally {
    await client.end()
  }
}

const subject = (difference: string) => difference.slice(difference.indexOf(': ') + 2)

beforeAll(async () => {
  migrated = await createTestDb('schema_parity_migrate', undefined, { blank: true })
  pushed = await createTestDb('schema_parity_push', undefined, { blank: true })
}, 120_000)

afterAll(async () => {
  await migrated?.drop()
  await pushed?.drop()
})

it('the migrations build the same schema as the collections, except the named exceptions', async () => {
  await Promise.all([build('migrate', migrated), build('push', pushed)])
  const [fromMigrations, fromCollections] = await Promise.all([describeSchema(migrated), describeSchema(pushed)])
  const differences = [
    ...[...fromMigrations].filter((l) => !fromCollections.has(l)).map((l) => `migrations only: ${l}`),
    ...[...fromCollections].filter((l) => !fromMigrations.has(l)).map((l) => `collections only: ${l}`),
  ]
  const named = (difference: string) => EXCEPTIONS.some((e) => subject(difference).startsWith(e.prefix))
  expect(differences.filter((d) => !named(d)), DRIFT_HELP).toEqual([])
  const stale = EXCEPTIONS.filter((e) => !differences.some((d) => subject(d).startsWith(e.prefix)))
  expect(stale, STALE_HELP).toEqual([])
}, 180_000)

it('every schema exception states its reason', () => {
  expect(EXCEPTIONS.filter((e) => e.reason.length < 20)).toEqual([])
})
