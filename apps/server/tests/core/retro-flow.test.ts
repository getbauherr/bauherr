import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWriter } from '../../src/core/forge/writer'
import type { Stage } from '../../src/core/events'
import { NotAllowedToChangeMemory } from '../../src/core/memory'
import { readDocument, documentVersions } from '../../src/core/memory-documents'
import { applyRetro, type ApplyDeps } from '../../src/core/retro/apply'
import {
  acceptProposal,
  prepareOpening,
  sendMessage,
  startRetro,
  type ConverseDeps,
} from '../../src/core/retro/converse'
import { buildOutcome } from '../../src/core/retro/outcome'
import { decideChange, decideTicket, editChange } from '../../src/core/retro/outcome-edit'
import { RetroUndecided } from '../../src/core/retro/schema'
import { loadRetro, messagesOf, saveAgreed } from '../../src/core/retro/store'
import { createRecord } from '../../src/core/record/store'
import { claim, enqueue } from '../../src/core/run/leases'
import { contextPack } from '../../src/core/run/pack'
import { fakeRetroModel } from '../../src/app/(app)/lib/fake-retro-model'
import { DAY, seedTicket } from './figures-seed'
import { source } from './fixtures'
import { openEngine, type Engine } from './harness'

let e: Engine
let outlier: number
const NOW = new Date('2026-11-24T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const FACTORY_REPO = 'acme/factory'
const CHANGE = { id: 'x', title: 't', section: 'Build', remove: null, add: '- f' }

const fake = new FakeBackend({ native: true, user: 'jo' })
const converse: ConverseDeps = { model: fakeRetroModel, skill: async () => 'skill', now: () => NOW }
const bauherr = () => ({ person: e.owner, workspace: e.db.workspace })
const admin = () => ({ person: { id: 'a1', role: 'admin', workspaceIds: [e.db.workspace] }, workspace: e.db.workspace })
const deps = (): ApplyDeps => ({
  writer: createWriter(e.db.payload, { backend: async () => fake, now: () => NOW }),
  factoryRepo: FACTORY_REPO,
})
const issues = async (repo: string) => (await fake.tickets(repo).list({ state: 'all' })).length
const range = { range: { from: ago(10), to: NOW }, label: 'last ten days' }

const link = async (repo: string, product: number, connection: number) =>
  e.db.payload.create({
    collection: 'ticket_sources',
    data: { repo, product, connection, workspace: e.db.workspace },
    overrideAccess: true,
  })

beforeAll(async () => {
  e = await openEngine('core_retro')
  for (const day of [1, 2, 3, 4, 5]) await seedTicket(e.db, { doneAt: ago(day), rounds: 1 })
  outlier = await seedTicket(e.db, { doneAt: ago(6), rounds: 6 })
  const o = { overrideAccess: true } as const
  const { payload, workspace } = e.db
  const connectionData = { name: 'gh', kind: 'github', workspace } as const
  const connection = Number((await payload.create({ collection: 'connections', data: connectionData, ...o })).id)
  const productData = { name: 'f', slug: 'f', workspace }
  const factoryProduct = Number((await payload.create({ collection: 'products', data: productData, ...o })).id)
  await e.db.payload.db.drizzle.execute(sql`UPDATE "products" SET "state" = 'active'`)
  await link('acme/app', e.db.product, connection)
  await link(FACTORY_REPO, factoryProduct, connection)
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  for (const table of ['retro_messages', 'retros', 'memory_document_versions']) {
    await e.db.payload.db.drizzle.execute(sql`DELETE FROM ${sql.identifier(table)}`)
  }
})

const start = () => startRetro(e.db.payload, converse, bauherr(), { product: e.db.product, ...range })
const begin = async () => {
  const id = await start()
  await prepareOpening(e.db.payload, converse, bauherr(), id)
  return id
}

const packOf = async (stage: Stage) => {
  const record = await createRecord(e.db.payload, {
    workspace: e.db.workspace,
    product: e.db.product,
    source: { ...source, number: 9100 + Math.floor(Math.random() * 800) },
    type: 'bug',
  })
  await e.drain()
  await enqueue(e.db.payload, record.id, { stage, role: 'builder', fingerprint: `fp-${record.id}` })
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role: 'builder', by: 't', now: e.clock.now })
  if (!claimed) throw new Error('no run')
  return contextPack(e.deps(), claimed.run)
}

describe('opening a Retro', () => {
  it('starts at once without asking the model, and a second start opens the same Retro', async () => {
    const model = vi.fn(fakeRetroModel)
    const quick = { ...converse, model }
    const input = { product: e.db.product, ...range }
    const first = await startRetro(e.db.payload, quick, bauherr(), input)
    expect(await startRetro(e.db.payload, quick, bauherr(), input)).toBe(first)
    expect(model).not.toHaveBeenCalled()
    expect(await messagesOf(e.db.payload, first)).toHaveLength(0)
  })

  it('writes the opening message once however often it is prepared', async () => {
    const id = await start()
    await Promise.all([1, 2].map(() => prepareOpening(e.db.payload, converse, bauherr(), id)))
    expect(await messagesOf(e.db.payload, id)).toHaveLength(1)
  })

  it('starts a new Retro once the earlier one has its opening', async () => {
    const first = await begin()
    expect(await start()).not.toBe(first)
  })

  it('holds the figures, the far-off ticket and a proposal with its evidence', async () => {
    const id = await begin()
    const retro = await loadRetro(e.db.payload, e.db.workspace, id)
    expect(retro?.opening?.figures.map((f) => f.key)).toContain('verifyRoundsPerTicket')
    expect(retro?.opening?.tickets.map((t) => t.recordId)).toEqual([outlier])
    const [first] = await messagesOf(e.db.payload, id)
    expect(first?.role).toBe('assistant')
    expect(first?.parts?.proposals[0]).toMatchObject({ level: 'product', evidence: [outlier] })
  })

  it('collects accepted proposals and points agreed in conversation', async () => {
    const id = await begin()
    await acceptProposal(e.db.payload, bauherr(), id, 'p1')
    await sendMessage(e.db.payload, converse, bauherr(), id, 'The mockup rule is right.')
    const retro = await loadRetro(e.db.payload, e.db.workspace, id)
    expect(retro?.agreed).toEqual(['p1', 'p2'])
    expect((await messagesOf(e.db.payload, id)).map((m) => m.role)).toEqual(['assistant', 'owner', 'assistant'])
  })

  it('refuses a proposal that was never made', async () => {
    const id = await begin()
    await expect(acceptProposal(e.db.payload, bauherr(), id, 'nope')).rejects.toThrow('does not exist')
  })
})

describe('applying the outcome', () => {
  const agreeAll = async (id: number, extra: string[] = []) => {
    await sendMessage(e.db.payload, converse, bauherr(), id, 'ok')
    await saveAgreed(e.db.payload, id, ['p1', 'p2', ...extra])
  }

  it('saves exactly the edited text as a Retro version that the next Build run gets', async () => {
    const id = await begin()
    await agreeAll(id)
    const outcome = await buildOutcome(e.db.payload, bauherr(), id)
    expect(outcome.documents.find((d) => d.scope === 'product')?.changes.map((c) => c.id)).toEqual(['p1'])
    await decideChange(e.db.payload, bauherr(), id, 'p1', 'keep')
    await decideChange(e.db.payload, bauherr(), id, 'p2', 'discard')
    await editChange(e.db.payload, bauherr(), id, 'p1', '- Edited by the owner: mockup first.')
    await applyRetro(e.db.payload, deps(), bauherr(), id)
    const target = { scope: 'product', workspace: e.db.workspace, product: e.db.product } as const
    expect(await readDocument(e.db.payload, target)).toBe('## Brief\n- Edited by the owner: mockup first.\n')
    expect((await documentVersions(e.db.payload, target))[0]?.reason).toBe('retro')
    expect(await documentVersions(e.db.payload, { scope: 'workspace', workspace: e.db.workspace })).toHaveLength(0)
    const pack = await packOf('brief')
    expect(pack.memory).toEqual([{ scope: 'product', text: '- Edited by the owner: mockup first.' }])
  })

  it('waits while a change is undecided and says so', async () => {
    const id = await begin()
    await agreeAll(id)
    await buildOutcome(e.db.payload, bauherr(), id)
    await expect(applyRetro(e.db.payload, deps(), bauherr(), id)).rejects.toBeInstanceOf(RetroUndecided)
  })

  it('needs an Admin for a Factory change and writes nothing without one', async () => {
    const id = await begin()
    await saveAgreed(e.db.payload, id, [])
    await sendMessage(e.db.payload, converse, bauherr(), id, 'ok')
    await buildOutcome(e.db.payload, bauherr(), id)
    const factory = { scope: 'factory', base: '', changes: [{ ...CHANGE, decision: 'keep' }] }
    await e.db.payload.db.drizzle.execute(sql`UPDATE "retros"
      SET "outcome" = jsonb_set("outcome", '{documents,0}', ${JSON.stringify(factory)}::jsonb) WHERE "id" = ${id}`)
    await expect(applyRetro(e.db.payload, deps(), bauherr(), id)).rejects.toBeInstanceOf(NotAllowedToChangeMemory)
    expect(await documentVersions(e.db.payload, { scope: 'factory' })).toHaveLength(0)
    await decideTicketsNone(id)
    await applyRetro(e.db.payload, deps(), admin(), id)
    expect(await readDocument(e.db.payload, { scope: 'factory' })).toBe('## Build\n- f\n')
  })
})

const decideTicketsNone = async (id: number) => {
  const retro = await loadRetro(e.db.payload, e.db.workspace, id)
  for (const change of retro?.outcome?.documents.flatMap((d) => d.changes) ?? []) {
    await decideChange(e.db.payload, bauherr(), id, change.id, change.id === 'x' ? 'keep' : 'discard')
  }
}

const ticketProposal = (id: string, title: string, repo: string) => ({
  id,
  level: 'ticket',
  title,
  cause: '',
  evidence: [],
  confidence: 'high',
  ticket: { title, body: 'Why it matters.', repo },
})

describe('opening tickets', () => {
  const withTickets = async () => {
    const id = await begin()
    await e.db.payload.db.drizzle.execute(sql`UPDATE "retros" SET "agreed" = '["t1","t2"]'::jsonb WHERE "id" = ${id}`)
    const proposals = [
      ticketProposal('t1', 'Check secrets first', 'factory'),
      ticketProposal('t2', 'Fit the sentence at 375 px', 'product'),
    ]
    const parts = JSON.stringify({ proposals, raw: '{}' })
    await e.db.payload.db.drizzle.execute(sql`INSERT INTO "retro_messages" ("workspace_id", "retro_id", "role", "body",
      "parts") VALUES (${e.db.workspace}, ${id}, 'assistant', 'More', ${parts}::jsonb)`)
    await buildOutcome(e.db.payload, bauherr(), id)
    return id
  }

  it('opens each kept ticket once on its repository, also when Apply is pressed again after an error', async () => {
    const id = await withTickets()
    await decideTicket(e.db.payload, bauherr(), id, 't1', 'keep')
    await decideTicket(e.db.payload, bauherr(), id, 't2', 'keep')
    const productBefore = await issues('acme/app')
    const factoryBefore = await issues(FACTORY_REPO)
    vi.spyOn(fake.tickets('acme/app'), 'create').mockRejectedValueOnce(new Error('forge down'))
    await expect(applyRetro(e.db.payload, deps(), bauherr(), id)).rejects.toThrow('forge down')
    expect(await issues(FACTORY_REPO)).toBe(factoryBefore + 1)
    await applyRetro(e.db.payload, deps(), bauherr(), id)
    await applyRetro(e.db.payload, deps(), bauherr(), id)
    expect(await issues(FACTORY_REPO)).toBe(factoryBefore + 1)
    expect(await issues('acme/app')).toBe(productBefore + 1)
    expect((await loadRetro(e.db.payload, e.db.workspace, id))?.state).toBe('applied')
  })

  it('opens nothing for a dropped ticket', async () => {
    const id = await withTickets()
    await decideTicket(e.db.payload, bauherr(), id, 't1', 'discard')
    await decideTicket(e.db.payload, bauherr(), id, 't2', 'discard')
    const before = await issues('acme/app')
    await applyRetro(e.db.payload, deps(), bauherr(), id)
    expect(await issues('acme/app')).toBe(before)
  })
})
