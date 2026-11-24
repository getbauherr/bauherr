import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_mcp_ask_options')
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})

const status = async (runId: number) =>
  (await m.e.db.payload.db.drizzle.execute(sql`SELECT "status" FROM "stage_runs" WHERE "id" = ${runId}`)).rows[0]
    ?.status

describe('ask options', () => {
  it.each([
    ['back to Brief', ['Send back to Brief: full redesign from a mockup', 'Keep the gaps Brief']],
    ['discard', ['Discard this ticket', 'Keep going']],
    ['close', ['Close the ticket as done', 'Keep going']],
    ['park', ['Park the ticket for later', 'Keep going']],
    ['close this ticket', ['Close this ticket as done', 'Keep going']],
    ['park the ticket', ['Parking the ticket until #555 lands', 'Keep going']],
    ['park with a label', ['Parked: wait for the owner', 'Keep going']],
    ['send it back', ['Send it back to Build', 'Keep going']],
  ])('refuses an option that promises to %s and keeps the run claimed', async (_name, options) => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    await expect(m.call('ask', { ...ids, question: 'How?', options }, m.agent(m.alpha))).rejects.toThrow(
      new RegExp(`Option "${options[0]}".*Back to Brief is already on the card`),
    )
    expect(await status(run.runId)).toBe('claimed')
    expect((await m.e.view(record)).waitingOn).toBe('agents')
    await m.e.drain()
  })

  it.each([
    [['Close this modal on save', 'Send the payload back to the caller', 'Send back 404 for an unknown session']],
    [['Parking is out of scope', 'Send it back to the client as JSON', 'Discard it and recompute from source']],
  ])('accepts normal options %#', async (options) => {
    await m.e.drain()
    const record = await m.begin()
    const run = await m.claimed(m.alpha)
    const ids = { runId: run.runId, leaseToken: run.leaseToken }
    expect(await m.call('ask', { ...ids, question: 'Which?', options }, m.agent(m.alpha))).toEqual({ status: 'asked' })
    expect(await m.e.view(record)).toMatchObject({ card: { card: 'question', options } })
    await m.e.drain()
  })
})
