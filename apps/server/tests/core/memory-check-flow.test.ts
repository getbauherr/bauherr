import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decide } from '../../src/core/decide'
import { enterIssues } from '../../src/core/intake/enter'
import type { Who } from '../../src/core/memory'
import { makeCheck } from '../../src/core/memory-check-store'
import { createWriter } from '../../src/core/forge/writer'
import { createRecord, readRecord } from '../../src/core/record/store'
import { selectMemories } from '../../src/core/run/memory-select'
import { ticket } from '../../src/core/views/ticket'
import { statementRecord, statementRecords } from '../../src/core/views/statement-records'
import { source } from './fixtures'
import { BRIEF, buildResult, flowHarness } from './modules-harness'
import { keep } from '../../src/app/(app)/lib/memory'

const f = flowHarness('core_memory_check_flow')

const writer = () => createWriter(f.h.payload(), { backend: async () => f.fake(), now: () => f.clock.now })
const owner = () => ({ id: 'u7', role: 'bauherr', workspaceIds: [f.h.ids.workspace] })
const who = (): Who => ({ person: owner(), workspace: f.h.ids.workspace })

const choose = async (id: number, ask: string, choice: string) => {
  const seq = (await f.view(id)).card?.seq ?? -1
  await decide(id, owner(), { ask, choice, seq }, f.subDeps())
}

const verdict = async (recordId: number, headSha: string, patchId: string) => {
  const criteria = []
  for (const criterion of ['c1', 'c2', 'c3']) {
    criteria.push({ id: criterion, status: 'met', proof: [await f.proof(recordId, criterion)] })
  }
  return { headSha, patchId, criteria, findings: [], verdict: 'pass', changes: [], walkthrough: [], notVerified: [] }
}

const cameBackOn = async (count: number) => {
  const marks = []
  for (let i = 0; i < count; i++) {
    const created = await createRecord(f.h.payload(), {
      workspace: f.h.ids.workspace,
      product: f.h.ids.product,
      source: { ...source, repo: 'acme/other', number: 500 + i },
      type: 'bug',
    })
    marks.push({ record: created.id })
  }
  const rows = await f.h.rows(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "kind", "scope", "applies", "text", "came_back",
      "updated_at", "created_at")
    VALUES (${f.h.ids.workspace}, ${f.h.ids.product}, 'written', 'product', 'always',
      'A forge answer that says "not in your plan" is an empty answer.', ${JSON.stringify(marks)}::jsonb, now(), now())
    RETURNING "id"`)
  return z.object({ id: z.coerce.number() }).parse(rows[0]).id
}

const handed = async () =>
  (
    await selectMemories(f.h.payload(), {
      product: f.h.ids.product,
      record: 0,
      stage: 'build',
      areas: [],
      words: [],
    })
  ).ids

describe('a memory that came back becomes a check, from the press to the accepted ticket', () => {
  it('flags the memory, opens the issue, takes it into Brief, raises its card and stops handing it out', async () => {
    const first = await f.start('active')
    await f.work(first.id, 'builder', { outcome: 'not-planned', type: 'bug', reason: 'not now' })
    const id = await cameBackOn(3)
    const read = () => statementRecord(f.h.payload(), { workspace: f.h.ids.workspace, id })
    expect((await read())?.check).toEqual({ kind: 'wants' })
    const rows = await statementRecords(f.h.payload(), { workspace: f.h.ids.workspace, product: f.h.ids.product })
    expect(keep(rows, 'check').map((row) => row.id)).toEqual([id])
    expect(await handed()).toContain(id)

    const number = await makeCheck(f.h.payload(), who(), { id }, writer())
    const issue = await f.fake().tickets(first.repo).get(String(number))
    expect(issue.title).toMatch(/^Prevent by a check: A forge answer/)
    expect((await read())?.check).toMatchObject({ kind: 'building', issue: number })

    await first.sync()
    const [entered] = await enterIssues(f.subDeps())
    const recordId = entered ?? 0
    expect(await readRecord(f.h.payload(), recordId)).toMatchObject({ stage: 'brief' })
    expect((await read())?.check).toMatchObject({ kind: 'building', record: recordId })

    await f.work(recordId, 'builder', BRIEF)
    expect((await f.view(recordId)).card).toMatchObject({ card: 'brief', reason: 'memory' })
    const shown = await ticket(f.h.payload(), { workspace: f.h.ids.workspace, recordId })
    expect(shown.fromMemory).toEqual({ id, text: 'A forge answer that says "not in your plan" is an empty answer.' })
    await choose(recordId, 'brief', 'approve')
    const pull = await f.pullFor(first.repo, 'fix', 'a.txt')
    await f.work(recordId, 'builder', buildResult(pull.number, pull.headSha, 'p1'))
    await first.sync()
    f.green(first.repo, pull.headSha)
    await first.sync()
    await f.work(recordId, 'verifier', await verdict(recordId, pull.headSha, 'p1'))
    expect(await handed()).toContain(id)
    await choose(recordId, 'result', 'accept')

    expect((await read())?.check).toMatchObject({ kind: 'since', issue: number, record: recordId })
    expect((await read())?.off).toBe(false)
    expect(await handed()).not.toContain(id)
  })
})
