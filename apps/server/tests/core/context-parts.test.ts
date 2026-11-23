import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Stage } from '../../src/core/events'
import type { Role } from '../../src/core/lifecycle'
import { AGENTS_FILE_MAX, cutAgentsFile } from '../../src/core/mirror/facts'
import { appendEvent, createRecord } from '../../src/core/record/store'
import { queryWords } from '../../src/core/mirror/match'
import { contextPack } from '../../src/core/run/pack'
import { enqueue, claim } from '../../src/core/run/leases'
import { recordFor } from '../../src/core/run/role-view'
import { readRun } from '../../src/core/run/store'
import { storeStatement } from '../../src/core/statements'
import { runPage } from '../../src/core/views/run'
import { ticket } from '../../src/core/views/ticket'
import { briefed, source } from './fixtures'
import { openEngine, type Engine } from './harness'
import { mirrorSource } from './scenario'

describe('queryWords', () => {
  it('keeps the distinct words of at least 4 letters or digits, lowercased', () => {
    expect(queryWords('Export the Timeout: with 2024 exports, export!')).toEqual([
      'export',
      'timeout',
      'with',
      '2024',
      'exports',
    ])
    expect(queryWords('Fix a bug or two')).toEqual([])
    expect(queryWords('')).toEqual([])
  })
})

describe('cutAgentsFile', () => {
  it('keeps a file within the limit', () => {
    expect(cutAgentsFile('# Rules\n')).toEqual({ text: '# Rules\n', cut: false })
  })

  it('cuts a longer file at the last line break before the limit and flags it', () => {
    const line = `${'x'.repeat(99)}\n`
    const cut = cutAgentsFile(line.repeat(200))
    expect(cut.cut).toBe(true)
    expect(cut.text.length).toBeLessThanOrEqual(AGENTS_FILE_MAX)
    expect(cut.text).toBe(line.repeat(119) + 'x'.repeat(99))
  })

  it('cuts at the limit when there is no line break', () => {
    expect(cutAgentsFile('y'.repeat(AGENTS_FILE_MAX + 5)).text).toHaveLength(AGENTS_FILE_MAX)
  })
})

describe('recordFor', () => {
  const record = briefed({ handoff: 'what the author says' })

  it('hides the author summary from the verifier and the reviewer, and from nobody else', () => {
    expect(recordFor('verifier', record).handoff).toBe('')
    expect(recordFor('reviewer', record).handoff).toBe('')
    expect(recordFor('builder', record).handoff).toBe('what the author says')
    expect(recordFor('verifier', record)).toEqual({ ...record, handoff: '' })
  })
})

let e: Engine
let rows: (query: ReturnType<typeof sql>) => Promise<Record<string, unknown>[]>
let item: Awaited<ReturnType<typeof mirrorSource>>['item']
let sourceId: number

beforeAll(async () => {
  e = await openEngine('core_context_parts')
  rows = async (query) => (await e.db.payload.db.drizzle.execute(query)).rows
  const mirror = await mirrorSource(e)
  item = mirror.item
  sourceId = mirror.source
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
  await rows(sql`DELETE FROM "statements"`)
})

const number = async (record: number) => {
  const found = await rows(sql`SELECT "source_number" FROM "records" WHERE "id" = ${record}`)
  return z.coerce.number().parse(found[0]?.source_number)
}

const ticketWith = async (title: string, goal = '', extra: { number?: number; product?: number } = {}) => {
  const created = await createRecord(e.db.payload, {
    workspace: e.db.workspace,
    product: extra.product ?? e.db.product,
    source: { ...source, number: extra.number ?? (await number(await e.db.fresh())) },
    type: 'bug',
  })
  if (extra.product === undefined) await item(created.record.source.number, { title })
  await rows(
    sql`UPDATE "records" SET "data" = jsonb_set("data", '{goal}', ${JSON.stringify(goal)}::jsonb)
      WHERE "id" = ${created.id}`,
  )
  return created.id
}

const runOf = async (record: number, stage: Stage, role: Role = 'builder') => {
  await e.drain()
  await enqueue(e.db.payload, record, { stage, role, fingerprint: `fp-${Math.random()}` })
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role, by: 't', now: e.clock.now })
  if (!claimed) throw new Error('no run')
  return claimed.run
}

const packOf = async (record: number, stage: Stage, role: Role = 'builder') =>
  contextPack(e.deps(), await runOf(record, stage, role))

const said = (
  record: number,
  text: string,
  kind: 'answer' | 'guidance' = 'answer',
  scope: 'ticket' | 'product' = 'product',
) => storeStatement(e.db.payload, record, { kind, text, scope })

describe('matching owner statements', () => {
  it('reach a brief, build and verify run from the Product\'s other tickets, best first, at most 5', async () => {
    const other = await ticketWith('Unrelated')
    const own = await ticketWith('Export timeout')
    await said(other, 'Export notes without the other word')
    await said(other, 'The export timeout is logged and the export timeout is retried')
    for (let i = 0; i < 6; i++) await said(other, `Another export timeout note ${i}`)
    await said(other, 'Something else entirely')
    const pack = await packOf(own, 'brief')
    expect(pack.statements).toHaveLength(5)
    expect(pack.statements[0]?.text).toContain('is retried')
    expect(pack.statements.every((s) => s.text.includes('timeout'))).toBe(true)
    expect(Object.keys(pack.statements[0] ?? {}).sort()).toEqual(['at', 'id', 'kind', 'text', 'ticket', 'why'])
    expect(pack.statements[0]).toMatchObject({ kind: 'answer', ticket: await number(other) })
    expect((await packOf(own, 'build')).statements).toHaveLength(5)
    expect((await packOf(own, 'verify', 'verifier')).statements).toHaveLength(5)
  })

  it('hands a ticket its own statements of any scope and only product statements of the others', async () => {
    const a = await ticketWith('Export timeout')
    const b = await ticketWith('Export timeout again')
    await said(a, 'Export timeout one-off for a', 'guidance', 'ticket')
    await said(a, 'Export timeout rule for the product', 'answer', 'product')
    const texts = async (record: number) => (await packOf(record, 'build')).statements.map((s) => s.text).sort()
    expect(await texts(a)).toEqual(['Export timeout one-off for a', 'Export timeout rule for the product'])
    expect(await texts(b)).toEqual(['Export timeout rule for the product'])
  })

  it('leaves out other Products, the intake stage and ticket-scoped statements of other tickets', async () => {
    const own = await ticketWith('Export timeout')
    const foreign = await e.db.payload.create({
      collection: 'products',
      data: { name: 'q', slug: 'q', workspace: e.db.workspace },
      overrideAccess: true,
    })
    const abroad = await ticketWith('Export timeout', '', { product: Number(foreign.id), number: 9001 })
    await said(abroad, 'Export timeout rules of another Product')
    expect((await packOf(own, 'brief')).statements).toEqual([])
    const near = await ticketWith('Reports')
    await said(near, 'Export timeout rules of a neighbour')
    await said(near, 'Export timeout one-off of a neighbour', 'guidance', 'ticket')
    expect((await packOf(own, 'intake')).statements).toEqual([])
    expect((await packOf(own, 'build')).statements.map((s) => s.text)).toEqual(['Export timeout rules of a neighbour'])
  })

  it('stay the same for the run when a new matching statement is stored', async () => {
    const other = await ticketWith('Reports')
    const own = await ticketWith('Export timeout')
    await said(other, 'First export timeout note')
    const run = await runOf(own, 'build')
    const first = await contextPack(e.deps(), run)
    await said(other, 'Second export timeout note')
    const second = await contextPack(e.deps(), run)
    const third = await contextPack(e.deps(), await readRun(e.db.payload, run.id))
    expect(first.statements.map((s) => s.text)).toEqual(['First export timeout note'])
    expect(second.statements).toEqual(first.statements)
    expect(third.statements).toEqual(first.statements)
    expect((await readRun(e.db.payload, run.id)).context?.statements).toEqual(first.statements.map((s) => s.id))
  })
})

describe('the shared-word rule for statements', () => {
  it('needs two shared words, ranks more first, and lets one word match a one-word query', async () => {
    const other = await ticketWith('Reports')
    const own = await ticketWith('Export timeout', 'Exports finish')
    await said(other, 'Export notes only')
    await said(other, 'Export timeout notes')
    await said(other, 'Export timeout, exports finish: three or more words')
    await said(other, 'Timeout only')
    expect((await packOf(own, 'build')).statements.map((s) => s.text)).toEqual([
      'Export timeout, exports finish: three or more words',
      'Export timeout notes',
    ])
    const single = await ticketWith('Billing is on')
    await said(other, 'Billing rules')
    await said(other, 'Invoices rules')
    expect((await packOf(single, 'build')).statements.map((s) => s.text)).toEqual(['Billing rules'])
    const quiet = await ticketWith('With that from this')
    await said(other, 'With that from this and that')
    expect((await packOf(quiet, 'build')).statements).toEqual([])
    const german = await ticketWith('Das wird nicht eine Loesung')
    await said(other, 'Wird nicht eine gute Idee')
    expect((await packOf(german, 'build')).statements).toEqual([])
    const none = await ticketWith('Fix it now')
    expect((await packOf(none, 'build')).statements).toEqual([])
  })
})

describe('similar tickets', () => {
  it('are up to 3 issues of the Product and only for a brief', async () => {
    const own = await ticketWith('Export timeout for reports')
    for (const kind of ['csv', 'pdf', 'xlsx', 'json']) await ticketWith(`Export timeout for ${kind}`)
    await item(7002, { title: 'Export timeout fix', kind: 'pr' })
    const { similar } = await packOf(own, 'brief')
    expect(similar).toHaveLength(3)
    expect(similar.every((s) => s.title.startsWith('Export timeout for'))).toBe(true)
    expect((await packOf(own, 'build')).similar).toEqual([])
  })

  it('tell accepted, closed with the reason and open apart', async () => {
    const own = await ticketWith('Backup restore speed')
    const accepted = await ticketWith('Backup restore speed on s3', 'Restores are fast')
    const discarded = await ticketWith('Backup restore speed on disk', 'Disk restores are fast')
    await ticketWith('Backup restore speed in the cloud', 'Cloud restores are fast')
    await rows(sql`UPDATE "records" SET "waiting_on" = 'nobody' WHERE "id" IN (${accepted}, ${discarded})`)
    await appendEvent(e.db.payload, accepted, { type: 'result.accepted', data: {}, actor: 'owner' })
    const closed = { type: 'ticket.closed', data: { reason: 'discarded' }, actor: 'owner' } as const
    await appendEvent(e.db.payload, discarded, closed)
    const { similar } = await packOf(own, 'brief')
    const record = (goal: string) => similar.find((s) => s.record?.goal === goal)?.record
    expect(record('Restores are fast')).toEqual({ goal: 'Restores are fast', outcome: 'accepted', reason: null })
    expect(record('Disk restores are fast')).toEqual({
      goal: 'Disk restores are fast',
      outcome: 'closed',
      reason: 'discarded',
    })
    expect(record('Cloud restores are fast')).toEqual({
      goal: 'Cloud restores are fast',
      outcome: 'open',
      reason: null,
    })
    expect(similar.every((s) => s.url.startsWith('https://forge/'))).toBe(true)
  })
})

describe('the repository file and the author summary', () => {
  it('delivers the stored AGENTS.md to every stage', async () => {
    const own = await ticketWith('Anything')
    await rows(
      sql`UPDATE "ticket_sources" SET "agents_file" = 'Use pnpm.', "agents_file_cut" = true WHERE "id" = ${sourceId}`,
    )
    expect((await packOf(own, 'intake')).agentsFile).toEqual({ text: 'Use pnpm.', cut: true })
    expect((await packOf(own, 'build')).agentsFile).toEqual({ text: 'Use pnpm.', cut: true })
    await rows(
      sql`UPDATE "ticket_sources" SET "agents_file" = NULL, "agents_file_cut" = NULL WHERE "id" = ${sourceId}`,
    )
    expect((await packOf(own, 'build')).agentsFile).toBeNull()
  })

  it('gives the verifier a record without the handoff and the builder the whole record', async () => {
    const own = await ticketWith('Anything')
    await rows(
      sql`UPDATE "records" SET "data" = jsonb_set("data", '{handoff}', '"built it"'::jsonb) WHERE "id" = ${own}`,
    )
    expect((await packOf(own, 'verify', 'verifier')).record.handoff).toBe('')
    expect((await packOf(own, 'build')).record.handoff).toBe('built it')
  })
})

describe('what a run used is shown', () => {
  it('lists the statements in the run view and in the ticket view, each once', async () => {
    const other = await ticketWith('Reports')
    const own = await ticketWith('Export timeout')
    await said(other, 'Export timeout note one', 'guidance')
    const brief = await runOf(own, 'brief')
    await contextPack(e.deps(), brief)
    await said(other, 'Export timeout note two')
    const view = { workspace: e.db.workspace }
    const before = await ticket(e.db.payload, { ...view, recordId: own })
    expect(before.statementsUsed.brief.map((s) => s.text)).toEqual(['Export timeout note one'])
    expect(before.statementsUsed.result).toEqual([])
    await appendEvent(e.db.payload, own, { type: 'brief.approved', data: { by: 'owner' }, actor: 'owner' })
    await contextPack(e.deps(), await runOf(own, 'build'))
    await contextPack(e.deps(), await runOf(own, 'verify', 'verifier'))
    const after = await ticket(e.db.payload, { ...view, recordId: own })
    expect(after.statementsUsed.brief.map((s) => s.text)).toEqual(['Export timeout note one'])
    expect(after.statementsUsed.result.map((s) => s.text).sort()).toEqual([
      'Export timeout note one',
      'Export timeout note two',
    ])
    expect(after.statementsUsed.brief[0]).toMatchObject({
      kind: 'guidance',
      scope: 'product',
      scopeLabel: 'This product',
      ticket: await number(other),
      record: other,
    })
    const page = await runPage(e.db.payload, { ...view, runId: brief.id, withCost: false })
    expect(page.parts).toContainEqual({ label: 'Memory', detail: '1' })
  })

  it('lists nothing for a ticket whose runs used no statements', async () => {
    const own = await ticketWith('Export timeout')
    await contextPack(e.deps(), await runOf(own, 'brief'))
    const view = await ticket(e.db.payload, { workspace: e.db.workspace, recordId: own })
    expect(view.statementsUsed).toEqual({ brief: [], result: [] })
  })
})

