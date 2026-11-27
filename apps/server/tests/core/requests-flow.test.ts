import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { beforeAll, describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { createWriter } from '../../src/core/forge/writer'
import { createConversation, storeFile } from '../../src/core/conversations/store'
import { readEvents, readRecord } from '../../src/core/record/store'
import type { CommentRole } from '../../src/core/requests/comments'
import { chooseType, closeRequest, joinExisting } from '../../src/core/requests/actions'
import { RequestInvalid } from '../../src/core/requests/errors'
import { tokenFits } from '../../src/core/requests/markdown'
import { sendRequest } from '../../src/core/requests/send'
import { createDraft, loadDraft, saveDraft } from '../../src/core/requests/store'
import { takeTurn, type TurnDeps } from '../../src/core/requests/turn'
import { draftView } from '../../src/core/requests/view'
import { requestStory } from '../../src/core/views/request-story'
import { PNG } from './images'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_requests')

const BUG = {
  type: 'bug',
  title: 'Export stops for big cities',
  summary: 'The export of the CO2 balance stops.',
  fields: {
    happened: 'It stops',
    expected: 'A file',
    steps: 'Press Export',
    where: 'CO2 balance, Export',
    frequency: 'Every time',
  },
  questions: [],
}

const ask = (field: string) => ({ field, text: `${field}?`, options: ['a', 'b'], suggested: 'a' })

type Script = (round: number) => object
const scripted = (script: Script): { deps: TurnDeps; calls: () => number } => {
  let calls = 0
  return {
    calls: () => calls,
    deps: {
      skill: () => Promise.resolve('skill'),
      similar: () => Promise.resolve(null),
      model: (_workspace, system) => {
        calls++
        const rounds = Number(/"rounds":(\d+)/.exec(system)?.[1] ?? 0)
        return Promise.resolve(JSON.stringify({ reply: 'Thank you.', ...script(rounds) }))
      },
    },
  }
}

let repo: string
let fake: FakeBackend
let writer: ReturnType<typeof createWriter>

beforeAll(async () => {
  repo = h.fresh()
  fake = new FakeBackend({ native: true, user: 'jo' })
  fake.commit(repo, 'main', 'README.md', '# x\n')
  writer = createWriter(h.payload(), { backend: () => Promise.resolve(fake), now: () => new Date() })
})

const draft = async () => {
  await h.sync({ [repo]: readerOf(fake) })
  await h.rows(sql`UPDATE "products" SET "state" = 'active' WHERE "id" = ${h.ids.product}`)
  const workspace = h.ids.workspace
  const conversationId = await createConversation(h.payload(), workspace, 'New request')
  await createDraft(h.payload(), { conversationId, workspace, product: h.ids.product, createdBy: 'anna@example.com' })
  return conversationId
}

const deliver = (conversationId: number, role: CommentRole = 'product-owner') =>
  sendRequest(
    h.payload(),
    { writer, origin: 'https://b.test', key: 'test-key' },
    { conversationId, reporter: 'anna', role },
  )

const say = (deps: TurnDeps, conversationId: number, text: string) =>
  takeTurn(h.payload(), deps, { conversationId, text, fileIds: [] })

const issueCount = async () => (await fake.tickets(repo).list({ state: 'all' })).length
const recordsOf = (number: number) =>
  h.rows(sql`SELECT "id" FROM "records" WHERE "source_repo" = ${repo} AND "source_number" = ${number}`)

describe('a complete bug', () => {
  it('is complete without a question round and Send creates the issue', async () => {
    const { deps } = scripted(() => BUG)
    const id = await draft()
    await say(deps, id, 'The export breaks for big cities. I press Export on the CO2 balance, every time.')
    const view = await draftView(h.payload(), id)
    expect(view).toMatchObject({ type: 'bug', complete: true, missing: [], questions: [], rounds: 0 })
    const before = await issueCount()
    const sent = await deliver(id)
    expect(await issueCount()).toBe(before + 1)
    expect(sent.issueNumber).toBeGreaterThan(0)
  })
})

describe('problem before solution', () => {
  it('asks for the problem first when a change arrives as a solution', async () => {
    const { deps } = scripted(() => ({
      type: 'change',
      title: 'Add a button',
      summary: 'A button',
      fields: {},
      questions: [ask('acceptance'), ask('who')],
    }))
    const id = await draft()
    await say(deps, id, 'Add a button')
    const view = await draftView(h.payload(), id)
    expect(view?.questions[0]?.field).toBe('problem')
    expect(view?.rounds).toBe(1)
  })
})

describe('the question limits', () => {
  it('asks no third round, lists what is missing on the card, and every question has a suggestion', async () => {
    const { deps } = scripted(() => ({
      type: 'bug',
      title: 't',
      summary: 's',
      fields: { happened: 'It stops' },
      questions: [ask('expected'), ask('steps')],
    }))
    const id = await draft()
    await say(deps, id, 'It stops')
    await say(deps, id, 'Some more')
    const second = await draftView(h.payload(), id)
    expect(second?.rounds).toBe(2)
    expect(second?.questions.every((q) => q.options.includes(q.suggested))).toBe(true)
    await say(deps, id, 'And more')
    const third = await draftView(h.payload(), id)
    expect(third).toMatchObject({ rounds: 2, questions: [], complete: false })
    expect(third?.missing).toEqual(['What was expected', 'Steps to reproduce', 'Where', 'How often'])
  })

  it('retries once when the model asks four questions, then refuses', async () => {
    const four = ['a', 'b', 'c', 'd'].map(ask)
    const { deps, calls } = scripted(() => ({ type: 'bug', title: 't', summary: 's', fields: {}, questions: four }))
    const id = await draft()
    await expect(say(deps, id, 'It stops')).rejects.toThrow(/at most 3 questions/)
    expect(calls()).toBe(2)
  })
})

describe('sending', () => {
  it('twice writes one issue and one ticket, the body has the disclosure, type, summary and files', async () => {
    const { deps } = scripted(() => BUG)
    const id = await draft()
    await say(deps, id, 'It breaks')
    const picture = { workspace: h.ids.workspace, conversationId: id, name: 'export-koeln.png' }
    await storeFile(h.payload(), { ...picture, contentType: 'image/png', bytes: PNG })
    const before = await issueCount()
    const first = await deliver(id)
    const second = await deliver(id)
    expect(second).toEqual(first)
    expect(await issueCount()).toBe(before + 1)
    const issue = await fake.tickets(repo).get(String(first.issueNumber))
    expect(issue.body.startsWith(DISCLOSURE)).toBe(true)
    expect(issue.body).toContain('Type: Something is broken (bug)')
    expect(issue.body).toContain('The export of the CO2 balance stops.')
    const pattern = `!\\[export-koeln\\.png\\]\\(https://b\\.test/api/request-files/${id}/(\\d+)/([\\w-]+)\\)`
    const link = new RegExp(pattern).exec(issue.body)
    expect(link).not.toBeNull()
    expect(issue.body).not.toContain('/api/conversations/')
    expect(tokenFits('test-key', id, Number(link?.[1]), link?.[2] ?? '')).toBe(true)
    expect(tokenFits('test-key', id, Number(link?.[1]) + 1, link?.[2] ?? '')).toBe(false)
    expect(await recordsOf(first.issueNumber)).toHaveLength(1)
    const events = (await readEvents(h.payload(), first.recordId)).filter((e) => e.type === 'intake.accepted')
    expect(events).toHaveLength(1)
    expect((await draftView(h.payload(), id))?.state).toBe('sent')
  })

  it.each([
    ['bauherr', 'Requested by the Bauherr in Bauherr.', false, 'anna (Bauherr)'],
    ['product-owner', 'Requested by a product owner in Bauherr.', true, 'anna (Product owner)'],
  ] as const)('names a %s as the author in issue, ticket and story', async (role, line, external, by) => {
    const { deps } = scripted(() => BUG)
    const id = await draft()
    await say(deps, id, 'It breaks')
    const sent = await deliver(id, role)
    const issue = await fake.tickets(repo).get(String(sent.issueNumber))
    expect(issue.body).toContain(line)
    const { source } = (await readRecord(h.payload(), sent.recordId)).record
    expect(source).toMatchObject({ reporter: 'anna', reporterRole: role, external })
    const story = await requestStory(h.payload(), { workspace: h.ids.workspace, recordId: sent.recordId })
    expect(story.events[0]).toMatchObject({ kind: 'sent', who: by })
    expect(story.about.by).toBe(by)
  })

  it('refuses to send a draft that is not complete, and names what is missing', async () => {
    const { deps } = scripted(() => ({ ...BUG, fields: { happened: 'It stops' } }))
    const id = await draft()
    await say(deps, id, 'It stops')
    await expect(deliver(id)).rejects.toThrow(/Still missing: What was expected/)
  })
})

describe('a similar open request', () => {
  it('is offered before the first question and joining creates no issue', async () => {
    const open = await fake.tickets(repo).create({ title: 'Invoice archive shows old totals after a refresh' })
    const { deps, calls } = scripted(() => BUG)
    const real: TurnDeps = { ...deps }
    delete real.similar
    const id = await draft()
    await say(real, id, 'The invoice archive shows old totals after a refresh')
    expect(calls()).toBe(0)
    const offered = await draftView(h.payload(), id)
    expect(offered?.offer).toMatchObject({ number: open.number })
    const before = await issueCount()
    await joinExisting(h.payload(), { writer }, id, 'product-owner')
    expect(await issueCount()).toBe(before)
    expect(await draftView(h.payload(), id)).toMatchObject({ state: 'joined', joined: { number: open.number } })
    const linked = await fake.tickets(repo).listComments(String(open.number))
    expect(linked).toHaveLength(1)
    expect(linked[0]?.body).toContain('Another product owner has the same request')
    const [stored] = await h.rows(sql`SELECT "issue_number" FROM "request_drafts" WHERE "conversation_id" = ${id}`)
    expect(Number(stored?.issue_number)).toBe(open.number)
    await expect(say(real, id, 'more')).rejects.toBeInstanceOf(RequestInvalid)
  })

  it('says it was the Bauherr when a Bauherr joins', async () => {
    const open = await fake.tickets(repo).create({ title: 'Dashboard tiles flicker on every refresh' })
    const { deps } = scripted(() => BUG)
    const real: TurnDeps = { ...deps }
    delete real.similar
    const id = await draft()
    await say(real, id, 'The dashboard tiles flicker on every refresh')
    await joinExisting(h.payload(), { writer }, id, 'bauherr')
    const body = (await fake.tickets(repo).listComments(String(open.number)))[0]?.body ?? ''
    expect(body).toContain('The Bauherr has the same request')
  })

  it('writes the join comment with the title as inert text', async () => {
    const open = await fake.tickets(repo).create({ title: 'Receipt export hangs for large accounts' })
    const evil = '[log in again](https://evil.example) <img src=x onerror=alert(1)> @everyone'
    const { deps } = scripted(() => BUG)
    const real: TurnDeps = { ...deps }
    delete real.similar
    const id = await draft()
    await say(real, id, 'The receipt export hangs for large accounts')
    const stored = await loadDraft(h.payload(), id)
    if (!stored) throw new Error('no draft')
    await saveDraft(h.payload(), id, { data: { ...stored.data, title: evil } })
    await joinExisting(h.payload(), { writer }, id, 'product-owner')
    const body = (await fake.tickets(repo).listComments(String(open.number)))[0]?.body ?? ''
    expect(body).not.toContain('](https://evil.example)')
    expect(body).not.toMatch(/(?<!\\)<img/)
    expect(body).toContain('\\[log in again\\]\\(https://evil.example\\)')
    expect(body).not.toMatch(/@everyone/)
  })
})

describe('a question', () => {
  it('gets an answer, can be closed without a ticket, and can turn into a bug', async () => {
    const { deps } = scripted(() => ({
      type: 'question',
      title: 'When do exports run?',
      summary: 's',
      fields: { question: 'When do exports run?' },
      answer: 'Nightly.',
    }))
    const id = await draft()
    await say(deps, id, 'When do exports run?')
    const view = await draftView(h.payload(), id)
    expect(view).toMatchObject({ type: 'question', answer: 'Nightly.', complete: true })
    const records = async () => Number((await h.rows(sql`SELECT count(*) AS n FROM "records"`))[0]?.n)
    const before = await records()
    await expect(deliver(id)).rejects.toThrow(/A question is answered here/)
    await chooseType(h.payload(), id, 'bug')
    expect(await draftView(h.payload(), id)).toMatchObject({ type: 'bug', answer: null, complete: false })
    await chooseType(h.payload(), id, 'question')
    await closeRequest(h.payload(), id)
    expect((await draftView(h.payload(), id))?.state).toBe('closed')
    expect(await records()).toBe(before)
  })
})
