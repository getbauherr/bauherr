import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { appendMessage, createConversation, storeFile } from '../../src/core/conversations/store'
import { ticket } from '../../src/core/views/ticket'
import { tierIn } from '../../src/core/run/tiers'
import { MODULES, skillFor, tierFor } from '../../src/lean'
import { openMcp, type Mcp } from './mcp-harness'

let m: Mcp
beforeAll(async () => {
  m = await openMcp('core_context_pack', MODULES)
}, 120_000)
afterAll(async () => {
  await m?.e.drop()
})
beforeEach(async () => {
  await m.e.drain()
})

const pack = z.object({
  status: z.literal('work'),
  context: z.object({
    stage: z.string(),
    model: z.object({ tier: z.string() }),
    skill: z.string().nullable(),
    facts: z.object({ missing: z.array(z.string()) }).nullable(),
    agentsFile: z.object({ text: z.string(), cut: z.boolean() }).nullable(),
    similar: z.array(z.unknown()),
    commentFiles: z.array(z.object({ name: z.string(), contentType: z.string(), bytes: z.number() })),
  }),
})

const claimWith = async (skills: (stage: string) => Promise<string | null>) => {
  const { agent } = m.agent(m.alpha)
  const contexts = { agent: { ...agent, deps: { ...agent.deps, skills: (stage: string) => skills(stage) } } }
  const { session } = z
    .object({ session: z.string() })
    .parse(await m.call('connect', { role: 'builder', clientSession: 'test-session-1' }, contexts))
  return pack.parse(await m.call('next_work', { session }, contexts))
}

describe('the context pack', () => {
  it('delivers the skill text of the stage and the intake facts to an intake run', async () => {
    await m.begin()
    const work = await claimWith((stage) => Promise.resolve(`skill of ${stage}`))
    expect(work.context.stage).toBe('intake')
    expect(work.context.skill).toBe('skill of intake')
    expect(work.context.facts?.missing).toEqual(['what happened', 'what was expected', 'steps to reproduce', 'where'])
  })

  it('returns the repository file and the similar tickets, empty when there are none', async () => {
    await m.begin()
    const work = await claimWith(() => Promise.resolve(null))
    expect(work.context).toMatchObject({ agentsFile: null, similar: [] })
  })

  it('has no skill when the loader finds none', async () => {
    await m.begin()
    const work = await claimWith(() => Promise.resolve(null))
    expect(work.context.skill).toBeNull()
  })
})

describe('the skill loader', () => {
  it('reads the skill of every stage that has a module and none for the others', async () => {
    for (const stage of ['intake', 'brief', 'build'] as const) {
      expect(await skillFor(stage, 'builder')).toMatch(/^# \w+/)
    }
    expect(await skillFor('verify', 'verifier')).toMatch(/^# Verify/)
    expect(await skillFor('verify', 'reviewer')).toMatch(/^# Review/)
    expect(await skillFor('ship', 'builder')).toBeNull()
  })
})

describe('the model tier', () => {
  it('names the tier of the role in pack/pack.yaml and standard for a role without one', async () => {
    expect(await tierFor('builder')).toBe('standard')
    expect(await tierFor('verifier')).toBe('strong')
    expect(await tierFor('reviewer')).toBe('strong')
    expect(tierIn({ roles: { builder: { tier: 'cheap' } } }, 'builder')).toBe('cheap')
    expect(tierIn({ roles: { builder: { tier: 'cheap' } } }, 'verifier')).toBe('standard')
    expect(tierIn({}, 'builder')).toBe('standard')
    expect(() => tierIn({ roles: { builder: { tier: 'huge' } } }, 'builder')).toThrow()
  })

  it('carries the tier in the pack of a run', async () => {
    await m.begin()
    const { agent } = m.agent(m.alpha)
    const contexts = { agent: { ...agent, deps: { ...agent.deps, tiers: () => Promise.resolve('cheap' as const) } } }
    const { session } = z
      .object({ session: z.string() })
      .parse(await m.call('connect', { role: 'builder', clientSession: 'test-session-1' }, contexts))
    expect(pack.parse(await m.call('next_work', { session }, contexts)).context.model).toEqual({ tier: 'cheap' })
    await m.e.drain()
    await m.begin()
    const plain = await claimWith(() => Promise.resolve(null))
    expect(plain.context.model).toEqual({ tier: 'standard' })
  })

  it('shows a file attached to a card comment on the ticket and hands it to the next run', async () => {
    const recordId = await m.begin()
    const { workspace, payload } = m.e.db
    const db = { db: { drizzle: payload.db.drizzle } }
    const conversationId = await createConversation(db, workspace, `Ticket ${recordId} comment`, recordId)
    const bytes = new TextEncoder().encode('mockup notes')
    const file = await storeFile(db, { workspace, conversationId, name: 'notes.txt', contentType: 'text/plain', bytes })
    await appendMessage(db, { workspace, conversationId, role: 'user', text: 'See notes', fileIds: [file.id] })
    expect((await ticket(payload, { workspace, recordId })).commentFiles).toEqual([{ ...file, conversationId }])
    const work = await claimWith(() => Promise.resolve(null))
    expect(work.context.commentFiles).toEqual([{ name: 'notes.txt', contentType: 'text/plain', bytes: bytes.length }])
  })
})

describe('fetch_file', () => {
  const attach = async (workspace: number, recordId: number, text: string) => {
    const db = { db: { drizzle: m.e.db.payload.db.drizzle } }
    const conversationId = await createConversation(db, workspace, `Ticket ${recordId} comment`, recordId)
    const file = await storeFile(db, {
      workspace,
      conversationId,
      name: 'notes.txt',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode(text),
    })
    await appendMessage(db, { workspace, conversationId, role: 'user', text: 'See notes', fileIds: [file.id] })
    return file.id
  }
  const claim = async () => {
    await m.begin()
    return m.claimed(m.alpha)
  }

  it('returns the bytes of a file attached to a comment of the ticket of the run', async () => {
    const work = await claim()
    const found = await m.e.db.payload.db.drizzle.execute(
      sql`SELECT "record_id" FROM "stage_runs" WHERE "id" = ${work.runId}`,
    )
    const fileId = await attach(m.e.db.workspace, z.coerce.number().parse(found.rows[0]?.record_id), 'screenshot notes')
    const got = await m.call('fetch_file', { runId: work.runId, leaseToken: work.leaseToken, fileId }, m.agent(m.alpha))
    expect(got).toEqual({
      name: 'notes.txt',
      contentType: 'text/plain',
      bytes: 16,
      base64: Buffer.from('screenshot notes').toString('base64'),
    })
  })

  it('refuses a file attached to another ticket', async () => {
    const work = await claim()
    const other = await m.begin()
    const fileId = await attach(m.e.db.workspace, other, 'other')
    await expect(
      m.call('fetch_file', { runId: work.runId, leaseToken: work.leaseToken, fileId }, m.agent(m.alpha)),
    ).rejects.toThrow(/not on a comment of this ticket/)
  })

  it('refuses a run of another workspace', async () => {
    const work = await claim()
    await expect(
      m.call('fetch_file', { runId: work.runId, leaseToken: work.leaseToken, fileId: 1 }, m.agent(m.beta)),
    ).rejects.toThrow(/does not exist/)
  })
})
