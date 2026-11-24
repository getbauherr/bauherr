import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { patchRecord, readRecord } from '../../src/core/record/store'
import { positionsOf } from '../../src/core/views/positions'
import { ticket } from '../../src/core/views/ticket'
import { openEngine, type Engine } from './harness'
import { seedTickets, type TicketNames } from './ticket-scenario'
import { LONG_HANDOFF, OPEN_FINDING } from './verify-rounds-fixtures'

let e: Engine
let names: TicketNames
beforeAll(async () => {
  e = await openEngine('core_verify_positions')
  names = await seedTickets(e)
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

const view = (recordId: number) => ticket(e.db.payload, { workspace: e.db.workspace, recordId })

describe('the verify-rounds card positions', () => {
  it('shows the last open finding and the capped last handoff read from the record', async () => {
    const t = await view(names.verifyRounds)
    expect(t.card).toMatchObject({ card: 'question', reason: 'verify-rounds' })
    expect(t.positions?.rounds).toBe(2)
    expect(t.positions?.verifier).toEqual({ text: OPEN_FINDING.text, cut: false })
    expect(t.positions?.builder).toEqual({ text: `${LONG_HANDOFF.slice(0, 599).trimEnd()}…`, cut: true })
    expect(t.positions?.handoffRunId).toBe(t.runs.findLast((r) => r.stage === 'build')?.id)
  })

  it('is absent on every other card', async () => {
    expect((await view(names.deployStalled)).positions).toBeNull()
    expect((await view(names.resultReadonly)).positions).toBeNull()
  })

  it('changes when the record changes', async () => {
    const { version } = await readRecord(e.db.payload, names.verifyRounds)
    const patch = { handoff: 'Short.', findings: [{ ...OPEN_FINDING, text: 'Other.' }] }
    const by = { stage: 'build', runId: 'seed' } as const
    const writes: ('handoff' | 'findings')[] = ['handoff', 'findings']
    await patchRecord(e.db.payload, names.verifyRounds, { expectedVersion: version, writes, patch, by })
    const t = await view(names.verifyRounds)
    expect(t.positions).toMatchObject({ verifier: { text: 'Other.' }, builder: { text: 'Short.', cut: false } })
  })

  it('caps a 2000 character handoff at 600 and a long finding at 300', async () => {
    const t = await view(names.verifyRounds)
    const record = { ...t.record, handoff: 'h'.repeat(2000), findings: [{ ...OPEN_FINDING, text: 'f'.repeat(301) }] }
    const positions = positionsOf({ card: t.card, record, runs: t.runs, events: [] })
    expect(positions?.builder).toEqual({ text: `${'h'.repeat(599)}…`, cut: true })
    expect(positions?.verifier).toEqual({ text: `${'f'.repeat(299)}…`, cut: true })
  })
})
