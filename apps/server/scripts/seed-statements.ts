import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { appendEvent, createRecord } from '../src/core/record/store'
import { rememberContext } from '../src/core/run/context'
import { enqueue } from '../src/core/run/leases'
import { storeStatement } from '../src/core/statements'

const o = { overrideAccess: true } as const
const source = { forge: 'github', repo: 'record/app', reporter: 'jo', external: false, backlog: false } as const
const NONE = { similar: [], agentsFile: { given: false, cut: false } }

type Seed = { workspace: number; product: number }

const release = async (p: Payload, record: number, stage: 'build' | 'verify', statements: number[]) => {
  const { run } = await enqueue(p, record, {
    stage,
    role: stage === 'build' ? 'builder' : 'verifier',
    fingerprint: `record-${record}-${stage}`,
  })
  await p.db.drizzle.execute(sql`UPDATE "stage_runs" SET "status" = 'released' WHERE "id" = ${run.id}`)
  await rememberContext(p, run.id, { ...NONE, statements })
  return run.id
}

const statement = async (p: Payload, record: number, text: string): Promise<number> => {
  await storeStatement(p, record, { kind: 'guidance', text })
  const found = await p.db.drizzle.execute(sql`SELECT max("id") AS id FROM "statements" WHERE "record_id" = ${record}`)
  return Number(found.rows[0]?.id)
}

const ticket = async (p: Payload, seed: Seed, number: number) =>
  (await createRecord(p, { ...seed, source: { ...source, number }, type: 'bug' })).id

const verdict = async (p: Payload, record: number, statements: number[], changes: boolean) => {
  await release(p, record, 'build', statements)
  const runId = String(await release(p, record, 'verify', []))
  const actor = 'agent'
  if (changes) await appendEvent(p, record, { type: 'verify.changes', actor, data: { runId, patchId: 'p' } })
  else await appendEvent(p, record, { type: 'verify.passed', actor, data: { runId, patchId: 'p', headSha: 'h' } })
}

export const seedStatements = async (p: Payload): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'record' } }, limit: 1, ...o })
  if (known.docs.length) return
  const data = { name: 'Record', slug: 'record' }
  const workspace = Number((await p.create({ collection: 'workspaces', data, ...o })).id)
  const app = { name: 'Record App', slug: 'record-app', workspace }
  const product = Number((await p.create({ collection: 'products', data: app, ...o })).id)
  const seed = { workspace, product }
  const first = await ticket(p, seed, 1)
  const queue = await statement(p, first, 'Never block the queue')
  const cite = await statement(p, first, 'Always cite the failing test')
  const old = await statement(p, first, 'Old rule nobody hit')
  await p.db.drizzle.execute(
    sql`UPDATE "statements" SET "created_at" = now() - interval '61 days' WHERE "id" = ${old}`,
  )
  await verdict(p, first, [queue, cite], true)
  await verdict(p, await ticket(p, seed, 2), [queue, cite], true)
  await verdict(p, await ticket(p, seed, 3), [queue, cite], false)
  await verdict(p, await ticket(p, seed, 4), [cite], true)
}
