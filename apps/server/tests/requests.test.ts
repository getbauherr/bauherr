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

const admin = (id: number) => ({ id, role: 'admin' })
const asMe = () => ({ id: me, role: 'bauherr' })

describe('loadWorkbench', () => {
  it('returns plain rows: Ticket number only, no stage or children; Product column only for several Products', async () => {
    const r = await requests.loadWorkbench(ws, asMe())
    expect(r.multiProduct).toBe(false)
    expect(r.factory).toEqual([expect.objectContaining({ title: 'Export totals drift', href: expect.stringMatching(/^\/requests\/\d+$/), ticket: { number: 7, id: undefined }, status: 'Being looked at', waits: 'The factory' })])
    await payload.create({ collection: 'products', data: { name: 'Two', slug: 'two', workspace: ws }, ...o })
    expect((await requests.loadWorkbench(ws, asMe())).multiProduct).toBe(true)
  })

  it('lists only sent requests (other people\'s drafts stay private), hides owner sessions, and filters by type and by Mine', async () => {
    const draft = (problem: string) => ({ problem, context: '', acceptance_criteria: [], type: 'bug', links: [] })
    const mk = (problem: string, extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'open', persona: 'product-user', messages: [], draft: draft(problem), ...extra }, ...o } as never)
    await mk('Own draft', { user: me })
    await mk('Embed draft', {})
    await mk('Owner flow', { user: me, persona: 'owner', status: 'submitted' })
    await mk('Mine sent', { user: me, status: 'submitted', ticketNumber: 31, kind: 'feature', title: 'My nice title' })
    const { factory } = await requests.loadWorkbench(ws, asMe())
    expect(factory.map((r) => r.title)).toEqual(expect.arrayContaining(['Export totals drift', 'My nice title']))
    expect(factory.some((r) => ['Own draft', 'Embed draft', 'Owner flow'].includes(r.title))).toBe(false)
    expect((await requests.loadWorkbench(ws, asMe(), { kind: 'feature' })).factory.map((r) => r.title)).toEqual(['My nice title'])
    expect((await requests.loadWorkbench(ws, asMe(), { mine: true })).factory.map((r) => r.title)).toEqual(['My nice title'])
  })

  it('sorts the sections: a need of the viewer is "Needs you", a closed Ticket is Done with its release note or the decline reason', async () => {
    const mkTicket = (number: number, extra: Record<string, unknown>) => payload.create({ collection: 'tickets', data: { title: `W${number}`, externalId: `wb-${number}`, number, url: `https://x/${number}`, state: 'open', labels: [], product, workspace: ws, rank: String(number), ...extra }, ...o } as never)
    const mkSession = (number: number, extra: Record<string, unknown> = {}) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], draft: { problem: `Work ${number}`, context: '', acceptance_criteria: [], type: 'bug', links: [] }, ticketNumber: number, user: me, ...extra }, ...o } as never)
    await mkTicket(41, { stage: 'triage', needsYou: 'Answer questions', labels: ['bauherr:needs-refinement'] })
    await mkTicket(42, { stage: 'triage', labels: ['bauherr:expedite-proposed'], needsYou: 'Expedite?' })
    await mkTicket(43, { stage: 'done', state: 'closed', mergeSha: 'abc', releasedIn: 'v1', labels: [] })
    const declined = await mkTicket(44, { stage: 'done', state: 'closed', labels: [] })
    await payload.create({ collection: 'runs', data: { ticket: declined.id, workspace: ws, stage: 'triage', kind: 'triage', status: 'succeeded', artifacts: { triage: { outcome: 'skip', reason: 'Already possible with the export button' } } }, ...o } as never)
    for (const n of [41, 42, 43, 44]) await mkSession(n)
    const mine = await requests.loadWorkbench(ws, asMe())
    expect(mine.needs.map((r) => [r.ticket?.number, r.status, r.waits])).toEqual([[41, 'Waiting for your answer', 'You']])
    const urgent = mine.factory.find((r) => r.ticket?.number === 42)
    expect(urgent).toMatchObject({ status: 'Urgent · waiting for the Bauherr', waits: 'The Bauherr', lane: 'proposed' })
    expect(mine.needs.some((r) => r.ticket?.number === 42)).toBe(false) // an Expedite is an Admin's decision, not this Bauherr's
    expect((await requests.loadWorkbench(ws, admin(me))).needs.map((r) => r.ticket?.number).sort()).toEqual([41, 42])
    expect(mine.done.find((r) => r.ticket?.number === 44)?.status).toBe('Declined: Already possible with the export button')
    expect(mine.done.find((r) => r.ticket?.number === 43)).toMatchObject({ status: 'Done' })
    // someone else's request: the requester's steps wait for "the requester", not "You"
    const other = Number((await payload.create({ collection: 'bauherren', data: { email: 'wb-other@example.com', password: 'x-pass-123', role: 'bauherr' }, ...o } as never)).id)
    await mkTicket(45, { stage: 'triage', needsYou: 'Answer questions', labels: [] })
    await mkSession(45, { user: other })
    const seen = await requests.loadWorkbench(ws, asMe())
    expect(seen.factory.find((r) => r.ticket?.number === 45)).toMatchObject({ waits: 'The requester', mine: false })
    expect(seen.needs.some((r) => r.ticket?.number === 45)).toBe(false)
  })
})

describe('timelineOf', () => {
  it('turns Ticket events into plain, once-only steps', () => {
    const e = (at: string, cause: string, stageKind: string, phase = 'working') => ({ at, cause, stageKind, phase })
    const t = requests.timelineOf('2026-11-11T08:00:00Z', [e('09', 'run:started', 'triage', 'human'), e('10', 'gate:approve:plan', 'plan'), e('11', 'run:claimed', 'review'), e('12', 'run:claimed', 'build'), e('13', 'run:claimed', 'review'), e('14', 'release:on_staging', 'release'), e('15', 'gate:accept:staging', 'release'), e('16', 'poll', 'done', 'closed')], true)
    expect(t.map((x) => x.text)).toEqual(['Sent', 'Question for you', 'Plan approved', 'Built', 'Ready for you to test', 'Accepted', 'Live'])
    expect(requests.timelineOf('x', [e('1', 'poll', 'done', 'closed')], false).map((x) => x.text)).toEqual(['Sent', 'Closed'])
  })
})

describe('loadRequest', () => {
  it('links a split request to both Tickets with plain status and a need, and hides foreign Workspaces, owner sessions and other people\'s requests from a Product owner', async () => {
    const mkTicket = (number: number, extra: Record<string, unknown>) => payload.create({ collection: 'tickets', data: { title: `T${number}`, externalId: `req-${number}`, number, url: `https://x/${number}`, state: 'open', labels: [], product, workspace: ws, rank: String(number), ...extra }, ...o } as never)
    await mkTicket(21, { stage: 'build', labels: ['bauherr:stage:build', 'bauherr:type:bug'] })
    await mkTicket(22, { stage: 'release', releaseState: 'timed_out', needsYou: 'Staging not confirmed', labels: ['bauherr:stage:release'] })
    const draft = { problem: 'Split request', context: 'ctx', acceptance_criteria: ['a', ' '], type: 'bug', links: [] }
    const mk = (extra: Record<string, unknown>) => payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], draft, ...extra }, ...o } as never).then((s) => Number(s.id))
    const split = await mk({ ticketNumber: 21, ticketNumbers: [21, 22] })
    const r = await requests.loadRequest(ws, split, asMe())
    expect(r).toMatchObject({ sent: true, own: false, title: 'Split request', card: { problem: 'Split request', criteria: ['a'], editable: false, sent: true } })
    expect(r?.tickets.map((t) => [t.number, t.status, t.need, t.kind])).toEqual([[21, 'Being built', null, 'bug'], [22, 'Going live', 'Staging not confirmed', null]])
    expect(r?.tickets.map((t) => [t.progress.headline, t.progress.step])).toEqual([['Being built.', 2], ['Stuck: the change could not be confirmed on staging.', 4]])
    expect((await requests.loadWorkbench(ws, asMe())).factory.find((x) => x.id === split)?.progress).toMatchObject({ headline: 'Being built.', step: 2 })
    expect((await requests.loadRequest(ws, await mk({ ticketNumber: 21 }), asMe()))?.tickets).toHaveLength(1)
    const ws2 = Number((await payload.create({ collection: 'workspaces', data: { name: 'r3', slug: 'r3' }, ...o })).id)
    expect(await requests.loadRequest(ws2, split, asMe())).toBeNull()
    expect(await requests.loadRequest(ws, await mk({ persona: 'owner' }), asMe())).toBeNull()
    const own = await mk({ status: 'open', user: me })
    expect(await requests.loadRequest(ws, own, asMe())).toMatchObject({ sent: false, own: true, mine: true, tickets: [], card: { editable: false } }) // the page's card only reads: a draft is edited in its conversation
    expect(await requests.loadRequest(ws, own, { id: me + 1000, role: 'bauherr' })).toMatchObject({ own: false, mine: false, card: { editable: false } })
    expect(await requests.loadRequest(ws, split, { id: me + 1000, role: 'product-owner' })).toBeNull()
    expect((await requests.loadWorkbench(ws, asMe())).factory.find((x) => x.id === split)?.href).toBe(`/requests/${split}`)
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
    const drafts = await requests.loadDrafts(asMe(), ws)
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
