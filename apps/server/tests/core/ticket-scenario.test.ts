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
    for (const id of [...names.briefApprove, names.briefTitle]) {
      const t = await view(id)
      expect(t.card).toMatchObject({ card: 'brief', reason: 'open-decision' })
      expect(t.record.decisions.map((d) => [d.id, d.options.length, d.answer])).toEqual([['d1', 2, undefined]])
    }
  })

  it('shows the earlier answers its Brief run used on one Brief and on no other', async () => {
    const used = (await view(names.briefAnswers)).statementsUsed
    expect(used.brief.map((s) => s.text)).toEqual([
      'Uploads and generated files go to object storage, not local disk.',
      'No new export formats before the reporting rework.',
    ])
    expect(used.brief.every((s) => s.record === names.resultReadonly)).toBe(true)
    expect((await view(names.briefTitle)).statementsUsed).toEqual({ brief: [], result: [] })
    const result = (await view(names.resultReadonly)).statementsUsed.result
    expect(result.map((s) => s.text)).toEqual([
      'Run the old export tests before the new ones.',
      'No new export formats before the reporting rework.',
    ])
    expect(result.every((s) => s.record === names.briefTitle)).toBe(true)
  })

  it('stops every Result ticket at a Result with proofs, findings, a pull request and a factory decision', async () => {
    const results = [names.resultReadonly, ...names.resultSendBack, ...names.resultAccept, ...names.resultStale]
    for (const id of results) {
      const t = await view(id)
      expect(t.card).toMatchObject({ card: 'result' })
      expect(t.proofs.map((g) => g.criterion)).toEqual(['c1', 'c2', 'c3'])
      expect(t.record.criteria.map((c) => c.status)).toEqual(['met', 'met', 'met'])
      expect(t.record.findings).toHaveLength(2)
      expect(t.record.decisions[0]).toMatchObject({ by: 'factory' })
      expect(t.pullRequest).not.toBeNull()
    }
  })

  it('stops one ticket at the card about a deploy that failed, with the link to the merge commit', async () => {
    const t = await view(names.deployStalled)
    expect(t.card).toMatchObject({ card: 'question', reason: 'deploy-stalled', options: ['check-again', 'continue'] })
    expect(t.deploy).toMatchObject({ reason: 'failed', checks: ['deploy-staging'] })
    expect(t.deploy?.url).toContain('/commit/sha-')
    expect(t.answerRemembered).toBe(false)
  })

  it('asks a question, waits for a reporter, and keeps a run with reported steps', async () => {
    for (const id of [...names.question, names.questionRead]) {
      expect((await view(id)).card).toMatchObject({ card: 'question', reason: 'agent' })
      expect((await view(id)).answerRemembered).toBe(true)
    }
    const intake = await view(names.intake)
    expect(intake).toMatchObject({ stage: 'intake', status: 'reporter-asked' })
    expect(intake.facts?.rounds.map((r) => r.round)).toEqual([1])
    const steps = await view(names.runSteps)
    expect(steps.status).toBe('building')
    expect(steps.runs.at(-1)?.steps).toHaveLength(4)
  })

  it('has an adopted ticket waiting on its author and one with a Result, each with its pull request', async () => {
    const waiting = await view(names.adoptedWaiting)
    expect(waiting).toMatchObject({
      status: 'waiting-on-author',
      waitingOn: 'author',
      adopted: { pr: 70, author: 'dev-sam' },
    })
    expect(waiting.otherPulls.map((pull) => [pull.number, pull.author, pull.state])).toEqual([[72, 'dev-lee', 'open']])
    const result = await view(names.adoptedResult)
    expect(result).toMatchObject({ stage: 'ship', card: { card: 'result' }, adopted: { pr: 71, author: 'dev-sam' } })
    expect(result.pullRequest?.state).toBe('open')
    expect(result.events.some((event) => event.type === 'ship.merged')).toBe(false)
  })
})
