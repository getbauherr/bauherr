import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CorruptRecord,
  CriteriaEditNotAllowed,
  FieldNotWritable,
  InvalidPatch,
  ProofRequired,
  RecordNotFound,
  StatusChangeNotAllowed,
  VersionConflict,
} from '../../src/core/record/errors'
import { checkPatch } from '../../src/core/record/guard'
import { emptyRecord, type RecordField } from '../../src/core/record/schema'
import {
  appendEvent,
  createRecord,
  patchRecord,
  readEvents,
  readRecord,
  setProjection,
  setRank,
} from '../../src/core/record/store'
import { createTestDb, type TestDb } from '../helpers/test-db'
import { criterion, source } from './fixtures'

const o = { overrideAccess: true } as const
let payload: Payload
let testDb: TestDb
let workspace: number
let otherWorkspace: number
let product: number
let n = 0

const fresh = async () => {
  n++
  return createRecord(payload, { workspace, product, source: { ...source, number: 1000 + n }, type: 'bug' })
}

const patch = (id: number, expectedVersion: number, stage: 'brief' | 'build' | 'verify', changes: object) =>
  patchRecord(payload, id, {
    expectedVersion,
    writes: Object.keys(changes) as RecordField[],
    patch: changes,
    by: { stage, runId: 'r1' },
  })

const briefedRow = async () => {
  const row = await fresh()
  const version = await patch(row.id, row.version, 'brief', {
    goal: 'Fix it',
    criteria: [criterion(1), criterion(2), criterion(3)],
  })
  return { id: row.id, version }
}

beforeAll(async () => {
  testDb = await createTestDb('core_store')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  const make = (slug: string) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })
  const idOf = (doc: { id: number | string }) => z.coerce.number().parse(doc.id)
  workspace = idOf(await make('alpha'))
  otherWorkspace = idOf(await make('beta'))
  product = idOf(await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o }))
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const run = (query: ReturnType<typeof sql>) => payload.db.drizzle.execute(query)

const count = async (table: string, where = sql`TRUE`) =>
  Number((await run(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${where}`)).rows[0]?.n)

describe('createRecord and readRecord', () => {
  it('stores an empty record at intake with version 1', async () => {
    const row = await fresh()
    expect(row).toMatchObject({ version: 1, stage: 'intake', waitingOn: 'agents', rank: 0 })
    expect(row.record).toMatchObject({ v: 1, goal: '', type: 'bug', criteria: [] })
    expect(await readRecord(payload, row.id)).toEqual(row)
  })

  it('is idempotent per source within a Workspace', async () => {
    const input = { workspace, product, source: { ...source, number: 5 }, type: 'bug' as const }
    const first = await createRecord(payload, input)
    const second = await createRecord(payload, { ...input, type: 'feature' })
    expect(second).toEqual(first)
    expect(await count('records', sql`"source_number" = 5 AND "workspace_id" = ${workspace}`)).toBe(1)
    const elsewhere = await createRecord(payload, { ...input, workspace: otherWorkspace })
    expect(elsewhere.id).not.toBe(first.id)
  })

  it('creates one row when the same source is created concurrently', async () => {
    const input = { workspace, product, source: { ...source, number: 6 }, type: 'bug' as const }
    const rows = await Promise.all([1, 2, 3, 4].map(() => createRecord(payload, input)))
    expect(new Set(rows.map((r) => r.id)).size).toBe(1)
    expect(await count('records', sql`"source_number" = 6 AND "workspace_id" = ${workspace}`)).toBe(1)
  })

  it('names the record and the failing path when the stored JSON does not parse', async () => {
    const row = await fresh()
    const broken = { ...row.record, source: { ...row.record.source, number: 'seven' } }
    const data = JSON.stringify(broken)
    await run(sql`UPDATE "records" SET "data" = ${data}::jsonb WHERE "id" = ${row.id}`)
    const failure = await readRecord(payload, row.id).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(CorruptRecord)
    expect((failure as Error).message).toContain(`Record ${row.id}`)
    expect((failure as Error).message).toContain('source.number')
  })

  it('refuses a record that does not exist', async () => {
    await expect(readRecord(payload, 987654)).rejects.toBeInstanceOf(RecordNotFound)
  })
})

describe('patchRecord', () => {
  it('writes the patch, bumps the version and keeps the other fields', async () => {
    const row = await fresh()
    expect(await patch(row.id, 1, 'brief', { goal: 'Fix it' })).toBe(2)
    const read = await readRecord(payload, row.id)
    expect(read.version).toBe(2)
    expect(read.record).toMatchObject({ goal: 'Fix it', type: 'bug' })
  })

  it('refuses a field outside writes', async () => {
    const row = await fresh()
    const attempt = patchRecord(payload, row.id, {
      expectedVersion: 1,
      writes: ['goal'],
      patch: { goal: 'ok', handoff: 'sneaky' },
      by: { stage: 'brief', runId: 'r1' },
    })
    await expect(attempt).rejects.toBeInstanceOf(FieldNotWritable)
    await expect(attempt).rejects.toThrow(/handoff/)
    expect((await readRecord(payload, row.id)).version).toBe(1)
  })

  it('refuses a patch that makes the record invalid', async () => {
    const row = await fresh()
    await expect(patch(row.id, 1, 'brief', { goal: 'x'.repeat(301) })).rejects.toBeInstanceOf(InvalidPatch)
    await expect(patch(row.id, 1, 'brief', { goal: 'x'.repeat(301) })).rejects.toThrow(/goal/)
  })

  it('refuses a stale version', async () => {
    const row = await fresh()
    await patch(row.id, 1, 'brief', { goal: 'a' })
    await expect(patch(row.id, 1, 'brief', { goal: 'b' })).rejects.toBeInstanceOf(VersionConflict)
  })

  it('gives exactly one success and one VersionConflict for two concurrent patches', async () => {
    const row = await fresh()
    const results = await Promise.allSettled([
      patch(row.id, 1, 'brief', { goal: 'first' }),
      patch(row.id, 1, 'brief', { goal: 'second' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(VersionConflict)
    expect((await readRecord(payload, row.id)).version).toBe(2)
  })

  it('lets many concurrent patches through one at a time', async () => {
    const row = await fresh()
    const goals = Array.from({ length: 8 }, (_, i) => patch(row.id, 1, 'brief', { goal: `g${i}` }))
    const results = await Promise.allSettled(goals)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await readRecord(payload, row.id)).version).toBe(2)
  })

  describe('criteria', () => {
    it('are added and reworded by the brief stage only', async () => {
      const { id, version } = await briefedRow()
      const reworded = [criterion(1, { text: 'new words' }), criterion(2), criterion(3)]
      await expect(patch(id, version, 'build', { criteria: reworded })).rejects.toBeInstanceOf(CriteriaEditNotAllowed)
      await expect(patch(id, version, 'verify', { criteria: [...reworded, criterion(4)] })).rejects.toBeInstanceOf(
        CriteriaEditNotAllowed,
      )
      await expect(patch(id, version, 'brief', { criteria: reworded })).resolves.toBe(version + 1)
    })

    it('change status in the verify stage only', async () => {
      const { id, version } = await briefedRow()
      const missing = [criterion(1, { status: 'missing' }), criterion(2), criterion(3)]
      await expect(patch(id, version, 'brief', { criteria: missing })).rejects.toBeInstanceOf(StatusChangeNotAllowed)
      await expect(patch(id, version, 'build', { criteria: missing })).rejects.toBeInstanceOf(StatusChangeNotAllowed)
      await expect(patch(id, version, 'verify', { criteria: missing })).resolves.toBe(version + 1)
    })

    it('are replaced by a new brief, dropping one and keeping the verdicts of the others', async () => {
      const { id, version } = await briefedRow()
      const verified = [criterion(1, { status: 'met', proof: ['t1'] }), criterion(2), criterion(3)]
      const verifiedVersion = await patch(id, version, 'verify', { criteria: verified })
      const renumbered = [
        { ...criterion(3), id: 'c1' },
        { ...criterion(1), id: 'c2' },
        criterion(3, { text: 'new one' }),
      ]
      await expect(patch(id, verifiedVersion, 'brief', { criteria: renumbered })).resolves.toBe(verifiedVersion + 1)
      const { record } = await readRecord(payload, id)
      expect(record.criteria.map((c) => [c.id, c.text, c.status, c.proof])).toEqual([
        ['c1', 'criterion 3', 'open', []],
        ['c2', 'criterion 1', 'met', ['t1']],
        ['c3', 'new one', 'open', []],
      ])
    })

    it('start open with no proof when reworded or new in a brief', async () => {
      const { id, version } = await briefedRow()
      const verified = [criterion(1, { status: 'met', proof: ['t1'] }), criterion(2), criterion(3)]
      const verifiedVersion = await patch(id, version, 'verify', { criteria: verified })
      const reworded = [criterion(1, { text: 'new words' }), criterion(2), criterion(3)]
      await patch(id, verifiedVersion, 'brief', { criteria: reworded })
      const { record } = await readRecord(payload, id)
      expect(record.criteria[0]).toMatchObject({ text: 'new words', status: 'open', proof: [] })
    })

    it('refuse a brief that sets a status on a new criterion', async () => {
      const { id, version } = await briefedRow()
      const met = [criterion(1, { text: 'new words', status: 'met', proof: ['t1'] }), criterion(2), criterion(3)]
      await expect(patch(id, version, 'brief', { criteria: met })).rejects.toBeInstanceOf(StatusChangeNotAllowed)
    })

    it('refuse a brief status change with the stage message unchanged', () => {
      const current = { ...emptyRecord(source, 'feature'), criteria: [criterion(1), criterion(2)] }
      const next = {
        ...current,
        criteria: [criterion(1, { status: 'met', proof: ['t1'] }), criterion(2)],
      }
      expect(() => checkPatch(current, next, { stage: 'brief', runId: 'r1' })).toThrow(
        'Criterion c1 changes status in stage brief: ' +
          'only a verify run records criterion status; leave status as it is.',
      )
    })

    it('become met or partial only with proof', async () => {
      const { id, version } = await briefedRow()
      for (const status of ['met', 'partial'] as const) {
        const without = [criterion(1, { status }), criterion(2), criterion(3)]
        await expect(patch(id, version, 'verify', { criteria: without })).rejects.toBeInstanceOf(ProofRequired)
      }
      const proved = [criterion(1, { status: 'met', proof: ['t1'] }), criterion(2), criterion(3)]
      await expect(patch(id, version, 'verify', { criteria: proved })).resolves.toBe(version + 1)
    })

    it('can be waived or marked missing without proof', async () => {
      const { id, version } = await briefedRow()
      const open = [criterion(1, { status: 'waived' }), criterion(2, { status: 'missing' }), criterion(3)]
      await expect(patch(id, version, 'verify', { criteria: open })).resolves.toBe(version + 1)
    })

    it('leave other fields free for any stage when the criteria stay as they are', async () => {
      const { id, version } = await briefedRow()
      const same = [criterion(1), criterion(2), criterion(3)]
      await expect(patch(id, version, 'build', { criteria: same, handoff: 'done' })).resolves.toBe(version + 1)
    })
  })
})

describe('projection and rank', () => {
  it('are written by their own functions and leave the version alone', async () => {
    const row = await fresh()
    await setProjection(payload, row.id, { stage: 'build', waitingOn: 'owner' })
    await setRank(payload, row.id, 4.5)
    const expected = { stage: 'build', waitingOn: 'owner', rank: 4.5, version: 1 }
    expect(await readRecord(payload, row.id)).toMatchObject(expected)
  })

  it('refuse a value outside the enumeration and a record that does not exist', async () => {
    const row = await fresh()
    const loose = async (id: number, value: object): Promise<void> => {
      await Reflect.apply(setProjection, undefined, [payload, id, value])
    }
    await expect(loose(row.id, { stage: 'review', waitingOn: 'owner' })).rejects.toThrow()
    await expect(loose(row.id, { stage: 'build', waitingOn: 'nobody-else' })).rejects.toThrow()
    const missing = setProjection(payload, 987654, { stage: 'build', waitingOn: 'owner' })
    await expect(missing).rejects.toBeInstanceOf(RecordNotFound)
    await expect(setRank(payload, 987654, 1)).rejects.toBeInstanceOf(RecordNotFound)
  })
})

describe('events', () => {
  it('come back in insertion order with their data and actor', async () => {
    const row = await fresh()
    const types = ['intake.accepted', 'intake.disputed', 'reporter.replied'] as const
    for (const type of types) await appendEvent(payload, row.id, { type, data: {}, actor: 'factory' })
    await appendEvent(payload, row.id, { type: 'brief.approved', data: { by: 'owner' }, actor: 'owner', actorId: 'u1' })
    const events = await readEvents(payload, row.id)
    expect(events.map((e) => e.type)).toEqual([...types, 'brief.approved'])
    expect(events[3]).toMatchObject({ data: { by: 'owner' }, actor: 'owner', actorId: 'u1', recordId: row.id })
    expect(events[0]).toMatchObject({ actorId: null })
    expect(new Set(events.map((e) => e.id)).size).toBe(4)
  })

  it('stay with their record and keep the Workspace of the record', async () => {
    const a = await fresh()
    const b = await fresh()
    await appendEvent(payload, a.id, { type: 'intake.accepted', data: {}, actor: 'factory' })
    expect(await readEvents(payload, b.id)).toEqual([])
    expect(await count('events', sql`"record_id" = ${a.id} AND "workspace_id" = ${workspace}`)).toBe(1)
  })

  it('refuse bad data, an unknown actor and an unknown record', async () => {
    const row = await fresh()
    const bad = { type: 'intake.asked', data: { round: 0 }, actor: 'factory' } as const
    await expect(appendEvent(payload, row.id, bad)).rejects.toThrow()
    const loose = async (value: object): Promise<void> => {
      await Reflect.apply(appendEvent, undefined, [payload, row.id, value])
    }
    await expect(loose({ type: 'intake.accepted', data: {}, actor: 'stranger' })).rejects.toThrow()
    await expect(
      appendEvent(payload, 987654, { type: 'intake.accepted', data: {}, actor: 'factory' }),
    ).rejects.toBeInstanceOf(RecordNotFound)
    expect(await readEvents(payload, row.id)).toEqual([])
  })

  it('fail to read when a stored event is corrupt', async () => {
    const row = await fresh()
    await appendEvent(payload, row.id, { type: 'intake.accepted', data: {}, actor: 'factory' })
    await run(sql`UPDATE "events" SET "type" = 'ship.exploded' WHERE "record_id" = ${row.id}`)
    await expect(readEvents(payload, row.id)).rejects.toThrow()
  })
})
