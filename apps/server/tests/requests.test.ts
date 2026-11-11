import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const o = { overrideAccess: true } as const
let payload: Payload
let testDb: TestDb
let requests: typeof import('../src/app/(app)/lib/requests')
let ws: number
let product: number
let me: number

beforeAll(async () => {
  testDb = await createTestDb('requests_261')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  requests = await import('../src/app/(app)/lib/requests')
  ws = Number((await payload.create({ collection: 'workspaces', data: { name: 'r', slug: 'r' }, ...o })).id)
  product = Number((await payload.create({ collection: 'products', data: { name: 'One', slug: 'one', workspace: ws }, ...o })).id)
  me = Number((await payload.create({ collection: 'bauherren', data: { email: 'me@example.com', password: 'x-pass-123', role: 'bauherr' }, ...o } as never)).id)
  const draft = { problem: 'Export totals drift', context: '', acceptance_criteria: [], type: 'bug', links: [] }
  await payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], draft, ticketNumber: 7 }, ...o } as never)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('loadRequests', () => {
  it('returns a plain row: Ticket number only, no stage or children; Product column only for several Products', async () => {
    const r = await requests.loadRequests(ws)
    expect(r.multiProduct).toBe(false)
    expect(r.rows).toEqual([expect.objectContaining({ title: 'Export totals drift', linked: true, ticket: { number: 7, id: undefined } })])
    await payload.create({ collection: 'products', data: { name: 'Two', slug: 'two', workspace: ws }, ...o })
    expect((await requests.loadRequests(ws)).multiProduct).toBe(true)
  })

  it('leaves the caller\'s own open Drafts to loadDrafts, lists other people\'s as rows without a link, and hides owner-persona sessions', async () => {
    const draft = (problem: string) => ({ problem, context: '', acceptance_criteria: [], type: 'bug', links: [] })
    const mk = (problem: string, extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'open', persona: 'product-user', messages: [], draft: draft(problem), ...extra }, ...o } as never)
    const mine = await mk('Own draft', { user: me })
    await mk('Embed draft', {})
    await mk('Owner flow', { user: me, persona: 'owner' })
    const { rows } = await requests.loadRequests(ws, me)
    expect(rows.some((r) => r.id === Number(mine.id))).toBe(false)
    expect(rows.find((r) => r.title === 'Embed draft')).toMatchObject({ linked: false, href: null })
    expect(rows.some((r) => r.title === 'Owner flow')).toBe(false)
    expect((await requests.loadRequests(ws)).rows.some((r) => r.title === 'Own draft')).toBe(true)
  })
})

describe('loadRequest', () => {
  it('links a split request to both Tickets with plain status and a need, and hides foreign Workspaces and owner sessions', async () => {
    const mkTicket = (number: number, extra: Record<string, unknown>) => payload.create({ collection: 'tickets', data: { title: `T${number}`, externalId: `req-${number}`, number, url: `https://x/${number}`, state: 'open', labels: [], product, workspace: ws, rank: String(number), ...extra }, ...o } as never)
    await mkTicket(21, { stage: 'build', labels: ['bauherr:stage:build'] })
    await mkTicket(22, { stage: 'release', releaseState: 'timed_out', needsYou: 'Staging not confirmed', labels: ['bauherr:stage:release'] })
    const draft = { problem: 'Split request', context: 'ctx', acceptance_criteria: ['a', ' '], type: 'bug', links: [] }
    const mk = (extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], draft, ...extra }, ...o } as never).then((s) => Number(s.id))
    const split = await mk({ ticketNumber: 21, ticketNumbers: [21, 22] })
    const r = await requests.loadRequest(ws, split, me)
    expect(r).toMatchObject({ sent: true, own: false, problem: 'Split request', criteria: ['a'] })
    expect(r?.tickets.map((t) => [t.number, t.status, t.need])).toEqual([[21, 'Being built', null], [22, 'On staging', 'Staging not confirmed']])
    expect(r?.tickets.map((t) => [t.progress.headline, t.progress.step])).toEqual([['Being built.', 2], ['Stuck: the change could not be confirmed on staging.', 4]])
    expect((await requests.loadRequests(ws)).rows.find((x) => x.id === split)?.progress).toMatchObject({ headline: 'Being built.', step: 2 })
    expect((await requests.loadRequest(ws, await mk({ ticketNumber: 21 })))?.tickets).toHaveLength(1)
    const ws2 = Number((await payload.create({ collection: 'workspaces', data: { name: 'r3', slug: 'r3' }, ...o })).id)
    expect(await requests.loadRequest(ws2, split)).toBeNull()
    expect(await requests.loadRequest(ws, await mk({ persona: 'owner' }))).toBeNull()
    const own = await mk({ status: 'open', user: me })
    expect(await requests.loadRequest(ws, own, me)).toMatchObject({ sent: false, own: true, mine: true, tickets: [] })
    expect(await requests.loadRequest(ws, own)).toMatchObject({ own: false, mine: false })
    expect((await requests.loadRequests(ws, me)).rows.find((x) => x.id === split)?.href).toBe(`/requests/${split}`)
    expect((await requests.loadRequests(ws, me)).rows.find((x) => x.id === own)).toBeUndefined() // an own Draft is listed by loadDrafts, not in the table
    expect((await requests.loadRequests(ws)).rows.find((x) => x.id === own)).toMatchObject({ linked: false, href: null }) // another person's Draft is a row without a link
  })
})

describe('loadDrafts', () => {
  const mk = (extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'open', persona: 'product-user', messages: [{ role: 'user', content: 'first words' }], draft: { problem: '', context: '', acceptance_criteria: [], type: 'bug', links: [] }, user: me, ...extra }, ...o } as never).then((s) => Number(s.id))

  it('lists every open Draft of the person, newest first and without a cut-off; not other people\'s, sent, abandoned, owner-persona or empty sessions', async () => {
    const other = Number((await payload.create({ collection: 'bauherren', data: { email: 'drafts-other@example.com', password: 'x-pass-123', role: 'bauherr' }, ...o } as never)).id)
    const older = await mk({ draft: { problem: 'Older draft', context: '', acceptance_criteria: [], type: 'bug', links: [] } })
    const ids = [older]
    for (let i = 0; i < 12; i++) ids.push(await mk({ draft: { problem: `Draft ${i}`, context: '', acceptance_criteria: [], type: 'bug', links: [] } }))
    const untitled = await mk({})
    const skipped = [await mk({ user: other }), await mk({ status: 'submitted' }), await mk({ status: 'abandoned' }), await mk({ persona: 'owner' }), await mk({ draft: null, messages: [] })]
    await payload.update({ collection: 'intake_sessions', id: older, data: { updatedAt: new Date(Date.now() + 120_000).toISOString() }, ...o } as never)
    const drafts = await requests.loadDrafts(me, ws)
    expect(drafts.map((d) => d.id)).toEqual(expect.arrayContaining([...ids, untitled]))
    expect(drafts[0]).toMatchObject({ id: older, title: 'Older draft', product: 'One' })
    expect(drafts.find((d) => d.id === untitled)?.title).toBe('first words')
    expect(drafts.length).toBeGreaterThan(12)
    for (const id of skipped) expect(drafts.some((d) => d.id === id)).toBe(false)
    expect(await requests.ownsDraft(me, ws, older)).toBe(true)
    for (const id of skipped.slice(0, 4)) expect(await requests.ownsDraft(me, ws, id)).toBe(false)
    expect(await requests.ownsDraft(me, ws, 99999999)).toBe(false)
  })
})

describe('countOwnDrafts', () => {
  const draft = { problem: 'p', context: '', acceptance_criteria: [], type: 'bug', links: [] }
  const mk = (extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'open', persona: 'product-user', messages: [{ role: 'user', content: 'hi' }], draft, user: me, ...extra }, ...o } as never).then((s) => String(s.id))

  it('countOwnDrafts counts only the caller\'s open Drafts that have messages', async () => {
    const before = await requests.countOwnDrafts(me, ws)
    const other = Number((await payload.create({ collection: 'bauherren', data: { email: 'counter@example.com', password: 'x-pass-123', role: 'bauherr' }, ...o } as never)).id)
    await mk({})
    await mk({ messages: [] })
    await mk({ user: other })
    await mk({ status: 'submitted' })
    expect(await requests.countOwnDrafts(me, ws)).toBe(before + 1)
    for (let i = 0; i < 11; i++) await mk({})
    expect(await requests.countOwnDrafts(me, ws)).toBe(before + 12)
  })
})
