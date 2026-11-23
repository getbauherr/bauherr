import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Person } from '../../src/core/decide'
import { createWriter } from '../../src/core/forge/writer'
import { enterIssues } from '../../src/core/intake/enter'
import { MemoryInvalid, MemoryNotFound, NotAllowedToChangeMemory, type Who } from '../../src/core/memory'
import { makeCheck } from '../../src/core/memory-check-store'
import { appendEvent, createRecord, readEvents, readRecord } from '../../src/core/record/store'
import { selectMemories } from '../../src/core/run/memory-select'
import { statementRecord } from '../../src/core/views/statement-records'
import { source } from './fixtures'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, clock, product } = intakeHarness('core_memory_check')

let numbers = 1000
const person = (): Person => ({ id: 'u7', role: 'bauherr', workspaceIds: [h.ids.workspace] })
const who = (): Who => ({ person: person(), workspace: h.ids.workspace })

const recordOf = (memory: number | null = null) =>
  createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { ...source, repo: 'acme/r1', number: numbers++, ...(memory === null ? {} : { memory }) },
    type: 'chore',
  })

type Fixture = { scope?: string; off?: boolean; cameBack?: number; applies?: string; text?: string }

const memory = async (f: Fixture = {}): Promise<number> => {
  const marks = []
  for (let i = 0; i < (f.cameBack ?? 0); i++) marks.push({ record: (await recordOf()).id })
  const rows = await h.rows(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "kind", "scope", "applies", "text", "off", "came_back",
      "updated_at", "created_at")
    VALUES (${h.ids.workspace}, ${h.ids.product}, 'written', ${f.scope ?? 'product'}, ${f.applies ?? 'always'},
      ${f.text ?? 'A forge answer that says "not in your plan" is empty.'}, ${f.off ?? false},
      ${JSON.stringify(marks)}::jsonb, now(), now())
    RETURNING "id"`)
  return z.object({ id: z.coerce.number() }).parse(rows[0]).id
}

const withIssue = async (id: number, events: Parameters<typeof appendEvent>[2]['type'][] = []) => {
  const issue = numbers++
  await h.rows(sql`UPDATE "statements" SET "check_issue" = ${issue} WHERE "id" = ${id}`)
  const prevention = await createRecord(h.payload(), {
    workspace: h.ids.workspace,
    product: h.ids.product,
    source: { ...source, repo: 'acme/r1', number: issue, memory: id },
    type: 'chore',
  })
  for (const type of events) {
    const data = type === 'ticket.closed' ? { reason: 'discarded' as const } : {}
    await appendEvent(h.payload(), prevention.id, { type, data, actor: 'owner' } as Parameters<typeof appendEvent>[2])
  }
  return { issue, record: prevention.id }
}

const stateOf = async (id: number) => {
  const found = await statementRecord(h.payload(), { workspace: h.ids.workspace, id })
  if (!found) throw new Error('gone')
  return found
}

const handedTo = async (): Promise<number[]> =>
  (
    await selectMemories(h.payload(), {
      product: h.ids.product,
      record: (await recordOf()).id,
      stage: 'brief',
      areas: [],
      words: [],
    })
  ).ids

describe('the check state read from a memory, its marks and the prevention record', () => {
  it('shows none, wants, building, since and discarded', async () => {
    const quiet = await memory({ cameBack: 2 })
    const flagged = await memory({ cameBack: 3 })
    const building = await memory({ cameBack: 3 })
    const built = await withIssue(building)
    const done = await memory({ cameBack: 4 })
    const finished = await withIssue(done, ['result.accepted'])
    const dropped = await memory({ cameBack: 5 })
    const discarded = await withIssue(dropped, ['ticket.closed'])
    const waiting = await memory({ cameBack: 3 })
    await h.rows(sql`UPDATE "statements" SET "check_issue" = 4242 WHERE "id" = ${waiting}`)
    expect((await stateOf(quiet)).check).toEqual({ kind: 'none' })
    expect((await stateOf(flagged)).check).toEqual({ kind: 'wants' })
    expect((await stateOf(building)).check).toEqual({ kind: 'building', issue: built.issue, record: built.record })
    expect((await stateOf(waiting)).check).toEqual({ kind: 'building', issue: 4242, record: null })
    expect((await stateOf(done)).check).toEqual({ kind: 'since', issue: finished.issue, record: finished.record })
    const gone = (await stateOf(dropped)).check
    expect(gone).toMatchObject({ kind: 'discarded', issue: discarded.issue, record: discarded.record })
    expect((await stateOf(dropped)).mayCheck).toBe(true)
    expect((await stateOf(done)).mayCheck).toBe(false)
  })

  it('reads a brief that was discarded as discarded, and an archived ticket that was restored as open', async () => {
    const one = await memory({ cameBack: 3 })
    await withIssue(one, ['brief.discarded'])
    expect((await stateOf(one)).check.kind).toBe('discarded')
    const two = await memory({ cameBack: 3 })
    await withIssue(two, ['ticket.closed', 'ticket.restored'])
    expect((await stateOf(two)).check.kind).toBe('building')
  })
})

describe('what a run is handed', () => {
  it('leaves a memory out once its check is accepted, and hands it out again after a discard', async () => {
    const open = await memory()
    const done = await memory()
    const dropped = await memory()
    await withIssue(open)
    await withIssue(done, ['result.accepted'])
    await withIssue(dropped, ['ticket.closed'])
    const handed = await handedTo()
    expect(handed).toContain(open)
    expect(handed).toContain(dropped)
    expect(handed).not.toContain(done)
    expect((await stateOf(done)).off).toBe(false)
  })
})

const setup = async (state: 'active' | 'observing' = 'active') => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'robo', trusted: ['jo'], bots: ['robo'] })
  await product(sql`"state" = ${state}`)
  await h.settle({ [repo]: readerOf(fake) })
  const writer = createWriter(h.payload(), { backend: async () => fake, now: () => clock.now })
  return { repo, fake, writer }
}

describe('making a check', () => {
  it('opens one issue with the memory, its marks as links and the ask, and keeps the number', async () => {
    const s = await setup()
    const id = await memory({ cameBack: 3 })
    const number = await makeCheck(h.payload(), who(), { id }, s.writer)
    const issue = await s.fake.tickets(s.repo).get(String(number))
    expect(issue.title).toBe('Prevent by a check: A forge answer that says "not in your plan" is empty.')
    expect(issue.body).toContain('A forge answer that says "not in your plan" is empty.')
    expect(issue.body).toContain('Make this impossible or caught automatically')
    expect(issue.body).toContain('Reference: bauherr-memory-')
    expect((await stateOf(id)).check).toEqual({ kind: 'building', issue: number, record: null })
  })

  it('refuses a second press while a ticket is open, and opens no second issue', async () => {
    const s = await setup()
    const id = await memory({ cameBack: 3 })
    await makeCheck(h.payload(), who(), { id }, s.writer)
    const before = (await s.fake.tickets(s.repo).list({ state: 'all' })).length
    await expect(makeCheck(h.payload(), who(), { id }, s.writer)).rejects.toThrow(/already being built/)
    expect((await s.fake.tickets(s.repo).list({ state: 'all' })).length).toBe(before)
  })

  it('opens a new issue after the first check was discarded', async () => {
    const s = await setup()
    const id = await memory({ cameBack: 3 })
    const first = await makeCheck(h.payload(), who(), { id }, s.writer)
    await h.sync({ [s.repo]: readerOf(s.fake) })
    const record = await recordOf(id)
    await h.rows(sql`UPDATE "records" SET "source_number" = ${first} WHERE "id" = ${record.id}`)
    await appendEvent(h.payload(), record.id, { type: 'ticket.closed', data: { reason: 'discarded' }, actor: 'owner' })
    expect((await stateOf(id)).check.kind).toBe('discarded')
    const second = await makeCheck(h.payload(), who(), { id }, s.writer)
    expect(second).not.toBe(first)
  })

  it('is for a person who may change memory, and another Workspace finds no such memory', async () => {
    const s = await setup()
    const id = await memory({ cameBack: 3 })
    const outsider: Who = { person: { ...person(), role: 'product-owner' }, workspace: h.ids.workspace }
    await expect(makeCheck(h.payload(), outsider, { id }, s.writer)).rejects.toThrow(NotAllowedToChangeMemory)
    const other: Who = { person: { ...person(), workspaceIds: [h.ids.workspace + 1] }, workspace: h.ids.workspace + 1 }
    await expect(makeCheck(h.payload(), other, { id }, s.writer)).rejects.toThrow(MemoryNotFound)
    expect((await stateOf(id)).check).toEqual({ kind: 'wants' })
  })

  it('refuses a ticket memory, a switched off memory and an observing Product with a reason', async () => {
    const s = await setup()
    const ticketOnly = await memory({ scope: 'ticket', applies: 'fit' })
    const off = await memory({ off: true })
    await expect(makeCheck(h.payload(), who(), { id: ticketOnly }, s.writer)).rejects.toThrow(/one ticket/)
    await expect(makeCheck(h.payload(), who(), { id: off }, s.writer)).rejects.toThrow(/Switch this memory on/)
    await product(sql`"state" = 'observing'`)
    const fine = await memory({ cameBack: 3 })
    const refused = makeCheck(h.payload(), who(), { id: fine }, s.writer)
    await expect(refused).rejects.toThrow(MemoryInvalid)
    await expect(refused).rejects.toThrow(/observing: nothing is written to the forge/)
    expect((await s.fake.tickets(s.repo).list({ state: 'all' })).length).toBe(0)
    expect((await stateOf(fine)).check).toEqual({ kind: 'wants' })
  })
})

describe('the issue of a memory enters without Intake', () => {
  it('gives it a record in Brief although its author is a bot, and still skips any other bot issue', async () => {
    const s = await setup()
    await s.fake.tickets(s.repo).create({ title: 'a bot issue', body: 'noise' })
    const id = await memory({ cameBack: 3 })
    const number = await makeCheck(h.payload(), who(), { id }, s.writer)
    const entered = await enterIssues(deps())
    expect(entered).toHaveLength(1)
    const stored = await readRecord(h.payload(), entered[0] ?? 0)
    expect(stored.record.source).toMatchObject({ number, memory: id, reporter: 'robo', external: false })
    expect(stored).toMatchObject({ stage: 'brief' })
    const types = (await readEvents(h.payload(), stored.id)).map((event) => event.type)
    expect(types.slice(0, 1)).toEqual(['intake.accepted'])
    expect(types).not.toContain('intake.asked')
    expect(await enterIssues(deps())).toEqual([])
    const all = await h.rows(sql`SELECT "source_number" FROM "records" WHERE "source_repo" = ${s.repo}`)
    expect(all).toHaveLength(1)
  })
})
