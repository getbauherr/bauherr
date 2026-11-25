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
