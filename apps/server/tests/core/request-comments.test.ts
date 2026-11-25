import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fold } from '../../src/core/fold'
import { commentsOf, postComment, requestConversation, type NewComment } from '../../src/core/requests/comments'
import { commentOnRequest, issueCommentBody, sendToIssue } from '../../src/core/requests/issue-comment'
import { storeFile } from '../../src/core/conversations/store'
import { createWriter } from '../../src/core/forge/writer'
import { inertBlock } from '../../src/core/forge/inert'
import { readEvents, readRecord } from '../../src/core/record/store'
import { requestStory } from '../../src/core/views/request-story'
import { PNG } from './images'
import { openEngine, type Engine } from './harness'
import { seedMockupTicket } from './mockup-scenario'
import { mirrorSource, seedScenario, type ScenarioNames } from './scenario'

let e: Engine
let names: ScenarioNames
beforeAll(async () => {
  e = await openEngine('core_request_comments')
  names = (await seedScenario(e)).names
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

const payload = () => e.db.payload
const PICTURE = { name: 'screen.png', contentType: 'image/png', bytes: PNG }

type Extra = Partial<NewComment>
const commentOn = async (recordId: number, extra: Extra = {}, withFile = false): Promise<NewComment> => {
  const workspace = e.db.workspace
  const conversationId = await requestConversation(payload(), workspace, recordId)
  const file = withFile
    ? await storeFile(payload(), { workspace, conversationId, ...PICTURE })
    : null
  return {
    workspace,
    recordId,
    conversationId,
    text: 'Does it also export PDF?',
    fileIds: file ? [file.id] : [],
    author: 'maria@example.com',
    role: 'product-owner',
    actorId: '7',
    ...extra,
  }
}

describe('a comment in any stage', () => {
  it('leaves the stage, the waiting state, the card and the folded state of every ticket unchanged', async () => {
    const ids = Object.values(names)
    expect(ids.length).toBeGreaterThanOrEqual(16)
    for (const id of ids) {
      const before = await readRecord(payload(), id)
      const folded = fold(await readEvents(payload(), id))
      await postComment(payload(), await commentOn(id))
      await postComment(payload(), await commentOn(id, { role: 'bauherr', author: 'bauherr@example.com' }))
      const after = await readRecord(payload(), id)
      expect([after.stage, after.waitingOn, after.card, after.parked, after.version]).toEqual([
        before.stage,
        before.waitingOn,
        before.card,
        before.parked,
        before.version,
      ])
      expect(fold(await readEvents(payload(), id))).toEqual(folded)
    }
  })

  it('shows to both sides in the story and in the ticket comments, with name and time', async () => {
    const id = names.briefCard
    const stored = await readEvents(payload(), id)
    const comments = await commentsOf(payload(), id, stored)
    expect(comments.map((c) => [c.author, c.role])).toEqual([
      ['maria@example.com', 'product-owner'],
      ['bauherr@example.com', 'bauherr'],
    ])
    const story = await requestStory(payload(), { workspace: e.db.workspace, recordId: id })
    const shown = story.events.filter((event) => event.kind === 'comment')
    expect(shown.map((event) => event.who)).toEqual(['maria@example.com', 'bauherr@example.com'])
    expect(shown[0]?.text).toBe('Does it also export PDF?')
  })

  it('refuses a conversation of another request', async () => {
    const other = await commentOn(names.building)
    await expect(postComment(payload(), { ...other, recordId: names.accepted })).rejects.toThrow(/does not belong/)
  })
})

describe('the issue comment', () => {
  const setup = async (earlier: number) => {
    const fake = new FakeBackend({ native: true, user: 'bot' })
    for (let i = 0; i < earlier; i++) await fake.tickets('acme/app').create({ title: `Filler ${i}` })
    const issue = await fake.tickets('acme/app').create({ title: 'Export progress' })
    const record = await seedMockupTicket(e)
    const db = payload().db.drizzle
    await db.execute(sql`UPDATE "records" SET "source_number" = ${issue.number},
      "data" = jsonb_set("data", '{source,number}', ${String(issue.number)}::jsonb) WHERE "id" = ${record}`)
    const { item } = await mirrorSource(e)
    await item(issue.number, { title: 'Export progress' })
    await db.execute(sql`UPDATE "products" SET "state" = 'active' WHERE "id" = ${e.db.product}`)
    const backend = vi.fn(() => Promise.resolve(fake))
    const forge = createWriter(payload(), { backend, now: () => new Date('2026-11-25T10:00:00Z') })
    const deps = { payload: payload(), forge, baseUrl: 'https://bauherr.test' }
    return { fake, issue, record, deps }
  }
  const bodies = async (fake: FakeBackend, number: string) =>
    (await fake.tickets('acme/app').listComments(number)).map((comment) => comment.body)

  it('is written once with text, file links and the plan picture, also after a retry', async () => {
    const { fake, issue, record, deps } = await setup(0)
    const comment = await commentOn(record, { text: 'Please keep the old @team layout. Closes #1' }, true)
    const event = await postComment(payload(), comment)
    await sendToIssue(deps, comment, event.data.messageId)
    await sendToIssue(deps, comment, event.data.messageId)
    const written = await bodies(fake, String(issue.number))
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('Please keep the old @team layout. Closes #1')
    expect(written[0]).toMatch(/\[screen\.png\]\(https:\/\/bauherr\.test\/api\/conversations\/\d+\/files\/\d+\)/)
    const picture = /Picture it refers to: \[Export page, new: progress bar\]\(\S+\/api\/attachments\/\d+\)/
    expect(written[0]).toMatch(picture)
  })

  it('is written once by the whole flow, as one comment per comment', async () => {
    const { fake, issue, record, deps } = await setup(1)
    await commentOnRequest(deps, await commentOn(record, { text: 'first' }))
    await commentOnRequest(deps, await commentOn(record, { text: 'second' }))
    expect(await bodies(fake, String(issue.number))).toHaveLength(2)
  })
})

describe('owner text in an issue comment', () => {
  it('cannot mention, close an issue, link or inject markup', () => {
    const body = issueCommentBody({
      author: 'x [evil](http://e.test) @team',
      role: 'product-owner',
      text: 'cc @team fixes #3 <img src=x> [click](http://e.test) ```` end',
      files: [{ name: 'a](http://e.test).png', url: 'https://bauherr.test/f/1' }],
      picture: null,
    })
    const outside = body.replace(/`{5}text\n[\s\S]*?\n`{5}/, '')
    expect(outside).not.toMatch(/@team|\[evil\]|\]\(http:\/\/e\.test\)/)
    expect(body).toContain('`````text\ncc @team fixes #3')
    const fenced = inertBlock('a ```` b')
    expect(fenced.startsWith('`````text')).toBe(true)
  })
})
