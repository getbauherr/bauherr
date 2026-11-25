import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { appendEvent, readRecord, setCard } from '../../src/core/record/store'
import { loadMockups } from '../../src/core/views/attachments'
import { mayOpenRequest, requestScope } from '../../src/core/views/request-access'
import { requestStory } from '../../src/core/views/request-story'
import { ticket } from '../../src/core/views/ticket'
import { openEngine, type Engine } from './harness'
import { MOCKUP_TICKET_TITLE, seedMockupTicket } from './mockup-scenario'

let e: Engine
let id: number
const LONG = `${'Please put it top left, that is where our paper reports carry the logo. '.repeat(6)}Thanks.`

beforeAll(async () => {
  e = await openEngine('core_request_story')
  id = await seedMockupTicket(e)
  const { source } = (await readRecord(e.db.payload, id)).record
  const found = await e.db.payload.db.drizzle.execute(
    sql`SELECT "id" FROM "mirror_items" WHERE "number" = ${source.number} AND "title" = ${MOCKUP_TICKET_TITLE}`,
  )
  const item = Number((found.rows[0] as { id: number }).id)
  const comment = (key: string, author: string, body: string, at: string) =>
    e.db.payload.db.drizzle.execute(sql`
      INSERT INTO "mirror_comments" ("workspace_id", "item_id", "forge_id", "author", "body", "forge_created_at",
        "updated_at", "created_at")
      VALUES (${e.db.workspace}, ${item}, ${key}, ${author}, ${body}, ${at}, now(), now())`)
  await comment('c1', 'anna', LONG, new Date(Date.now() + 60_000).toISOString())
  await comment('c2', 'bot', `${DISCLOSURE}\nRun 7 cost $1.`, new Date(Date.now() + 120_000).toISOString())
  await comment('c3', 'sebastian', 'Agreed, top left.', new Date(Date.now() + 180_000).toISOString())
}, 120_000)

afterAll(async () => {
  await e?.drop()
})

const story = () => requestStory(e.db.payload, { workspace: e.db.workspace, recordId: id })

describe('the request story', () => {
  it('waiting for the plan: sent, plan with pictures and checks, comments in full, oldest first', async () => {
    const result = await story()
    expect(result.status).toBe('brief-needs-approval')
    expect(result.events.map((event) => event.kind)).toEqual(['sent', 'plan', 'comment', 'comment'])
    const [sent, plan, first, second] = result.events
    expect(sent?.title).toBe('Request sent')
    expect(plan?.lists[0]?.heading).toBe('What will be checked')
    expect(plan?.lists[0]?.items.length).toBeGreaterThanOrEqual(3)
    expect(first?.text).toBe(LONG)
    expect(second?.text).toBe('Agreed, top left.')
    expect(result.events.map((event) => event.at)).toEqual([...result.events.map((event) => event.at)].sort())
  })

  it('the plan shows the same pictures as the Brief card', async () => {
    const result = await story()
    const plan = result.events.find((event) => event.kind === 'plan')
    const cards = (await loadMockups(e.db.payload, id)).map((mockup) => mockup.id)
    expect(plan?.images.map((image) => image.id)).toEqual(cards)
    expect(cards.length).toBeGreaterThan(0)
  })

  it('ready to try: before and after equal the pictures of the Result card, then the close', async () => {
    const { workspace } = e.db
    await appendEvent(e.db.payload, id, { type: 'brief.approved', data: { by: 'owner' }, actor: 'owner' })
    await appendEvent(e.db.payload, id, { type: 'brief.submitted', data: { runId: '0' }, actor: 'agent' })
    const passed = { runId: '0', patchId: 'p', headSha: 'h' }
    await appendEvent(e.db.payload, id, { type: 'verify.passed', data: passed, actor: 'agent' })
    await setCard(e.db.payload, id, { card: 'result', reason: 'ready', options: [], seq: 1 })
    const result = await story()
    const view = await ticket(e.db.payload, { workspace, recordId: id })
    expect(result.status).toBe('result-ready')
    const ready = result.events.findLast((event) => event.kind === 'ready')
    const pictures = view.pairs.flatMap((pair) => [pair.before?.id, pair.after?.id]).filter((n) => n !== undefined)
    expect(ready?.images.map((image) => image.id)).toEqual(pictures)
    expect(pictures.length).toBeGreaterThan(0)
    expect(ready?.lists[0]?.heading).toBe('What was checked')
    const plans = result.events.filter((event) => event.kind === 'plan')
    expect(plans.map((plan) => plan.title)).toEqual(['The plan', 'Plan updated'])
    expect(plans[0]?.lists).toEqual([])
  })

  it('shows no runs, agents, review rounds, cost or code', async () => {
    const text = JSON.stringify(await story())
    expect(text).not.toMatch(/"(runs?|cost|usd|agents?|findings|patchId|headSha|diff|shape|handoff)"/)
    expect(text).not.toMatch(/Run 7|\$1|patch|review round/i)
  })
})

describe('who may open a request', () => {
  const ws = (n: number) => ({ workspace: n, product: 5 })
  const owner = (assignments: unknown[]) => ({ role: 'product-owner', assignments })

  it('a Product owner opens only the Products assigned to them', () => {
    const own = owner([{ workspace: 1, scope: 'products', products: [5] }])
    expect(mayOpenRequest(own, ws(1))).toBe(true)
    expect(mayOpenRequest(own, { workspace: 1, product: 6 })).toBe(false)
    expect(mayOpenRequest(own, ws(2))).toBe(false)
    expect(mayOpenRequest(owner([{ workspace: 1, scope: 'workspace' }]), { workspace: 1, product: 6 })).toBe(true)
  })

  it('a Bauherr opens the requests of their Workspaces', () => {
    const member = { role: 'bauherr', tenants: [{ tenant: 1 }] }
    expect(mayOpenRequest(member, ws(1))).toBe(true)
    expect(mayOpenRequest(member, ws(2))).toBe(false)
    expect(mayOpenRequest({ role: 'admin' }, ws(2))).toBe(true)
  })

  it('finds the Workspace and Product of a request, and nothing for an unknown one', async () => {
    expect(await requestScope(e.db.payload, id)).toEqual({ workspace: e.db.workspace, product: e.db.product })
    expect(await requestScope(e.db.payload, 99_999_999)).toBeNull()
  })
})
