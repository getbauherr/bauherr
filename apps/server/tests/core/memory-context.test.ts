import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Stage } from '../../src/core/events'
import type { Role } from '../../src/core/lifecycle'
import { addMemory, setMemoryOff } from '../../src/core/memory-store'
import type { MemoryInput } from '../../src/core/memory'
import { createRecord } from '../../src/core/record/store'
import { claim, enqueue } from '../../src/core/run/leases'
import { contextPack } from '../../src/core/run/pack'
import { readRun } from '../../src/core/run/store'
import { storeStatement } from '../../src/core/statements'
import { runPage } from '../../src/core/views/run'
import { statementFare, statementRecords } from '../../src/core/views/statement-records'
import { source } from './fixtures'
import { openEngine, type Engine } from './harness'
import { mirrorSource } from './scenario'

let e: Engine
let item: Awaited<ReturnType<typeof mirrorSource>>['item']
let next = 7000

const sqlRows = async (query: ReturnType<typeof sql>) => (await e.db.payload.db.drizzle.execute(query)).rows

beforeAll(async () => {
  e = await openEngine('core_memory_context')
  item = (await mirrorSource(e)).item
  await e.db.payload.update({
    collection: 'products',
    id: e.db.product,
    data: { riskAreas: ['adapters', 'billing'] },
    overrideAccess: true,
  })
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.drain()
  await sqlRows(sql`DELETE FROM "statements"`)
})

const ticketWith = async (title: string, areas: string[] = []) => {
  const created = await createRecord(e.db.payload, {
    workspace: e.db.workspace,
    product: e.db.product,
    source: { ...source, number: next++ },
    type: 'bug',
  })
  await item(created.record.source.number, { title })
  const risk = JSON.stringify({ door: 'two-way', areas, rollback: 'revert' })
  await sqlRows(
    sql`UPDATE "records" SET "data" = jsonb_set("data", '{risk}', ${risk}::jsonb) WHERE "id" = ${created.id}`,
  )
  return created.id
}

const write = (text: string, over: Partial<MemoryInput> = {}) =>
  addMemory(e.db.payload, { person: e.owner, workspace: e.db.workspace }, {
    product: e.db.product,
    input: { text, reach: 'fit', stages: ['brief', 'build', 'review', 'verify'], ...over },
  })

const packOf = async (record: number, stage: Stage = 'build', role: Role = 'builder') => {
  await e.drain()
  await enqueue(e.db.payload, record, { stage, role, fingerprint: `fp-${next++}` })
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role, by: 't', now: e.clock.now })
  if (!claimed) throw new Error('no run')
  return { pack: await contextPack(e.deps(), claimed.run), run: claimed.run }
}

const handed = async (record: number, stage: Stage = 'build', role: Role = 'builder') =>
  (await packOf(record, stage, role)).pack.statements.map((s) => [s.text, s.why])

describe('what a run is handed', () => {
  it('gives every ticket the memories for every ticket, marked always, even when no word is shared', async () => {
    await write('Use Sie in German texts.', { reach: 'always' })
    expect(await handed(await ticketWith('Export timeout'))).toEqual([['Use Sie in German texts.', 'always']])
  })

  it('gives an area memory only to a ticket whose record names the area', async () => {
    await write('Empty forge answers are not failures.', { reach: 'area', area: 'adapters' })
    expect(await handed(await ticketWith('Sync', ['adapters', 'billing']))).toEqual([
      ['Empty forge answers are not failures.', 'area'],
    ])
    expect(await handed(await ticketWith('Sync', ['billing']))).toEqual([])
    expect(await handed(await ticketWith('Sync'))).toEqual([])
  })

  it('gives a fit memory only for shared words, marked fit, at most 5', async () => {
    for (let i = 0; i < 7; i++) await write(`Export timeout rule number ${i}.`)
    await write('Billing rules only.')
    const found = await handed(await ticketWith('Export timeout'))
    expect(found).toHaveLength(5)
    expect(found.every(([text, why]) => String(text).includes('timeout') && why === 'fit')).toBe(true)
  })

  it('keeps always and area outside the limit of five and lists nobody twice', async () => {
    await write('Standing rule.', { reach: 'always' })
    await write('Area rule export.', { reach: 'area', area: 'adapters' })
    for (let i = 0; i < 6; i++) await write(`Export timeout rule ${i}.`)
    const found = await handed(await ticketWith('Export timeout', ['adapters']))
    expect(found).toHaveLength(7)
    expect(found.slice(0, 2).map(([, why]) => why).sort()).toEqual(['always', 'area'])
    expect(new Set(found.map(([text]) => text)).size).toBe(7)
  })

  it('leaves out a memory that is off, and one without the run stage', async () => {
    const off = await write('Switched off rule.', { reach: 'always' })
    await write('Build only rule.', { reach: 'always', stages: ['build'] })
    await write('Review only rule.', { reach: 'always', stages: ['review'] })
    await setMemoryOff(e.db.payload, { person: e.owner, workspace: e.db.workspace }, { id: off, off: true })
    const record = await ticketWith('Export timeout')
    expect(await handed(record, 'brief')).toEqual([])
    expect(await handed(record, 'build')).toEqual([['Build only rule.', 'always']])
    expect(await handed(record, 'verify', 'reviewer')).toEqual([['Review only rule.', 'always']])
    expect(await handed(record, 'verify', 'verifier')).toEqual([])
  })

  it('hands a ticket-only memory to its own ticket and to no other', async () => {
    const own = await ticketWith('Export timeout')
    await storeStatement(e.db.payload, own, { kind: 'guidance', scope: 'ticket', text: 'Export timeout note.' })
    expect(await handed(own)).toEqual([['Export timeout note.', 'fit']])
    expect(await handed(await ticketWith('Export timeout again'))).toEqual([])
  })

  it('hands nothing at the intake stage and keeps the reasons on the stored run', async () => {
    await write('Use Sie.', { reach: 'always' })
    expect(await handed(await ticketWith('Export timeout'), 'intake')).toEqual([])
    const { run } = await packOf(await ticketWith('Export timeout'))
    const stored = await readRun(e.db.payload, run.id)
    expect(Object.values(stored.context?.reasons ?? {})).toEqual(['always'])
  })
})

describe('the memory views', () => {
  const area = z.string()

  it('lists each memory with its place, counts and state, and shows the run page what a run was told', async () => {
    const always = await write('Use Sie.', { reach: 'always' })
    await write('Adapter rule.', { reach: 'area', area: 'adapters' })
    const record = await ticketWith('Export timeout', ['adapters'])
    const { run } = await packOf(record)
    const listed = await statementRecords(e.db.payload, { workspace: e.db.workspace, product: e.db.product })
    expect(listed.map((r) => [r.text, r.reachLabel, r.handed, r.off]).sort()).toEqual([
      ['Adapter rule.', 'Area: adapters', 1, false],
      ['Use Sie.', 'Every ticket', 1, false],
    ])
    const page = await runPage(e.db.payload, { workspace: e.db.workspace, runId: run.id, withCost: false })
    expect(page.memory.map((m) => [m.text, m.reason]).sort()).toEqual([
      ['Adapter rule.', 'area: adapters'],
      ['Use Sie.', 'every ticket'],
    ])
    const fares = await statementFare(e.db.payload, { workspace: e.db.workspace, id: always })
    expect(fares).toMatchObject([{ run: run.id, ticket: { record } }])
    expect(area.parse(page.memory[0]?.reason)).toBeTruthy()
  })

  it('shows nothing of another Workspace', async () => {
    const id = await write('Use Sie.', { reach: 'always' })
    expect(await statementFare(e.db.payload, { workspace: e.db.workspace + 1, id })).toEqual([])
    expect(await statementRecords(e.db.payload, { workspace: e.db.workspace + 1, product: e.db.product })).toEqual([])
  })
})
