import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ticket } from '../../src/core/views/ticket'
import { openEngine, type Engine } from './harness'
import { seedTickets, type TicketNames } from './ticket-scenario'

let e: Engine
let names: TicketNames
beforeAll(async () => {
  e = await openEngine('core_ticket_scenario')
  names = await seedTickets(e)
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

const view = (recordId: number) => ticket(e.db.payload, { workspace: e.db.workspace, recordId })

describe('the tickets the end-to-end specs read', () => {
  it('stops two Briefs at an open decision with two options', async () => {
    for (const id of [names.briefApprove, names.briefTitle]) {
      const t = await view(id)
      expect(t.card).toMatchObject({ card: 'brief', reason: 'open-decision' })
      expect(t.record.decisions.map((d) => [d.id, d.options.length, d.answer])).toEqual([['d1', 2, undefined]])
    }
  })

  it('stops four tickets at a Result with proofs, findings, a pull request and a factory decision', async () => {
    for (const id of [names.resultReadonly, names.resultSendBack, names.resultAccept, names.resultStale]) {
      const t = await view(id)
      expect(t.card).toMatchObject({ card: 'result' })
      expect(t.proofs.map((g) => g.criterion)).toEqual(['c1', 'c2', 'c3'])
      expect(t.record.criteria.map((c) => c.status)).toEqual(['met', 'met', 'met'])
      expect(t.record.findings).toHaveLength(2)
      expect(t.record.decisions[0]).toMatchObject({ by: 'factory' })
      expect(t.pullRequest).not.toBeNull()
    }
  })

  it('asks a question, waits for a reporter, and keeps a run with reported steps', async () => {
    for (const id of [names.question, names.questionRead]) {
      expect((await view(id)).card).toMatchObject({ card: 'question', reason: 'agent' })
    }
    const intake = await view(names.intake)
    expect(intake).toMatchObject({ stage: 'intake', status: 'reporter-asked' })
    expect(intake.facts?.rounds.map((r) => r.round)).toEqual([1])
    const steps = await view(names.runSteps)
    expect(steps.status).toBe('building')
    expect(steps.runs.at(-1)?.steps).toHaveLength(4)
  })
})
